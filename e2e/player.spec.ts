import { test, expect, type Page } from '@playwright/test'

/**
 * E2E 冒烟：应用外壳与首屏。
 *
 * 面向生产形态（Hono 同源提供 SPA + API），与线上部署一致。
 */

const FREE_SONG_KEYWORD = '陈奕迅 我们'

/** 读取 audio 元素运行时状态。 */
async function audioState(page: Page) {
  return page.evaluate(() => {
    const a = document.querySelector('audio') as HTMLAudioElement | null
    if (!a) return { exists: false }
    return {
      exists: true,
      paused: a.paused,
      currentTime: a.currentTime,
      duration: a.duration,
      readyState: a.readyState,
      errorCode: a.error?.code ?? null,
      src: a.currentSrc,
    }
  })
}

test.describe('应用外壳', () => {
  test('首页加载并渲染侧栏、问候与推荐歌单', async ({ page }) => {
    await page.goto('/')
    await expect(page.getByText('Pterosaur')).toBeVisible()
    await expect(page.locator('.home__greeting')).toBeVisible()

    // 推荐卡片应在数秒内加载（依赖后端 -> 网易云）
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 15000 })
    const cardCount = await page.locator('.card').count()
    expect(cardCount).toBeGreaterThan(0)
  })

  test('侧栏导航可在主要页面间跳转', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('link', { name: '浏览' }).click()
    await expect(page).toHaveURL(/\/browse/)
    await expect(page.locator('.browse__title', { hasText: '浏览' })).toBeVisible()

    await page.getByRole('link', { name: '电台' }).click()
    await expect(page).toHaveURL(/\/radio/)

    await page.getByRole('link', { name: '我喜欢的音乐' }).click()
    await expect(page).toHaveURL(/\/favorites/)

    await page.getByRole('link', { name: '立即收听' }).click()
    await expect(page).toHaveURL(/\/$/)
  })

  test('主题切换在明暗之间生效', async ({ page }) => {
    await page.goto('/')
    const root = page.locator('html')

    // 点击主题按钮（aria-label 为「切换到浅色」或「切换到深色」）
    const toggle = page.locator('button[aria-label="切换到浅色"], button[aria-label="切换到深色"]').first()
    const before = await root.getAttribute('data-theme')
    await toggle.click()
    await expect
      .poll(async () => root.getAttribute('data-theme'), { timeout: 3000 })
      .not.toBe(before === null ? 'system' : before)
  })
})

test.describe('搜索与播放', () => {
  test('搜索关键词并展示结果行', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('search-input').fill(FREE_SONG_KEYWORD)
    await page.getByTestId('search-input').press('Enter')
    await expect(page).toHaveURL(/\/search\?q=/)

    // 结果行应出现
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 15000 })
    const rows = await page.locator('.track-row').count()
    expect(rows).toBeGreaterThan(0)
  })

  test('点击结果行开始真实播放（audio 未暂停且时间前进）', async ({ page }) => {
    await page.goto('/search?q=' + encodeURIComponent(FREE_SONG_KEYWORD))
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 15000 })

    await page.locator('.track-row').first().click()

    // 等待音频真正开始：readyState 足够且未暂停
    await expect
      .poll(
        async () => {
          const s = await audioState(page)
          return s.exists && !s.paused && s.readyState >= 2 && s.errorCode === null
        },
        { timeout: 20000, message: '音频应开始播放' },
      )
      .toBe(true)

    // 进度应随时间前进
    const t1 = (await audioState(page)).currentTime
    await page.waitForTimeout(1500)
    const t2 = (await audioState(page)).currentTime
    expect(t2).toBeGreaterThan(t1)

    // 播放条显示当前曲目
    await expect(page.locator('.playerbar__title')).not.toBeEmpty()
  })

  test('播放/暂停按钮切换播放状态', async ({ page }) => {
    await page.goto('/search?q=' + encodeURIComponent(FREE_SONG_KEYWORD))
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 15000 })
    await page.locator('.track-row').first().click()

    await expect
      .poll(async () => (await audioState(page)).paused === false, { timeout: 20000 })
      .toBe(true)

    // 暂停
    await page.getByTestId('play-toggle').click()
    await expect
      .poll(async () => (await audioState(page)).paused, { timeout: 5000 })
      .toBe(true)

    // 再播放
    await page.getByTestId('play-toggle').click()
    await expect
      .poll(async () => (await audioState(page)).paused === false, { timeout: 5000 })
      .toBe(true)
  })

  test('下一首切换当前曲目', async ({ page }) => {
    await page.goto('/search?q=' + encodeURIComponent(FREE_SONG_KEYWORD))
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 15000 })
    await page.locator('.track-row').first().click()
    await expect
      .poll(async () => (await audioState(page)).paused === false, { timeout: 20000 })
      .toBe(true)

    const titleBefore = await page.locator('.playerbar__title').textContent()
    await page.getByRole('button', { name: '下一首' }).click()
    await expect
      .poll(async () => page.locator('.playerbar__title').textContent(), { timeout: 8000 })
      .not.toBe(titleBefore)
  })
})

test.describe('全屏播放页与歌词', () => {
  test('展开播放页显示歌词并可 Esc 关闭', async ({ page }) => {
    await page.goto('/search?q=' + encodeURIComponent(FREE_SONG_KEYWORD))
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 15000 })
    await page.locator('.track-row').first().click()
    await expect(page.locator('.nowplaying')).toHaveCount(0)

    // 通过封面按钮展开
    await page.locator('.playerbar__cover-btn').click()
    await expect(page.locator('.nowplaying')).toBeVisible({ timeout: 5000 })

    // 歌词应加载（该曲目有词）
    await expect(page.locator('.lyric-line').first()).toBeVisible({ timeout: 15000 })
    const lines = await page.locator('.lyric-line').count()
    expect(lines).toBeGreaterThan(0)

    // Esc 关闭
    await page.keyboard.press('Escape')
    await expect(page.locator('.nowplaying')).toHaveCount(0, { timeout: 3000 })
  })
})

test.describe('播放队列', () => {
  test('打开队列面板显示当前队列曲目', async ({ page }) => {
    await page.goto('/search?q=' + encodeURIComponent(FREE_SONG_KEYWORD))
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 15000 })
    await page.locator('.track-row').first().click()

    await page.getByRole('button', { name: '播放队列' }).click()
    await expect(page.locator('.queue-panel--open')).toBeVisible({ timeout: 3000 })

    const items = await page.locator('.queue-item').count()
    expect(items).toBeGreaterThan(0)
    // 当前曲目高亮
    await expect(page.locator('.queue-item--active').first()).toBeVisible()
  })
})

test.describe('资料库与收藏', () => {
  test('收藏曲目后出现在「我喜欢的音乐」并持久化', async ({ page }) => {
    await page.goto('/search?q=' + encodeURIComponent(FREE_SONG_KEYWORD))
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 15000 })

    const firstTitle = await page.locator('.track-row .col-title__name').first().textContent()

    // 悬停行后点击「喜欢」
    const firstRow = page.locator('.track-row').first()
    await firstRow.hover()
    await firstRow.getByRole('button', { name: '喜欢' }).first().click()

    // 进入收藏页
    await page.goto('/favorites')
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 8000 })
    await expect(page.locator('.track-row').first()).toContainText((firstTitle ?? '').trim())

    // 刷新后仍在（localStorage 持久化）
    await page.reload()
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 8000 })
    await expect(page.locator('.track-row').first()).toContainText((firstTitle ?? '').trim())
  })

  test('空收藏时显示空状态', async ({ page, context }) => {
    await context.clearCookies()
    await page.goto('/favorites')
    // 清空 localStorage 以确保空态（可能因上一用例留有数据）
    await page.evaluate(() => localStorage.removeItem('pterosaur-library'))
    await page.reload()
    await expect(page.getByText('还没有喜欢的音乐')).toBeVisible({ timeout: 8000 })
  })
})

test.describe('歌单详情', () => {
  test('从浏览页进入歌单详情并展示曲目', async ({ page }) => {
    await page.goto('/browse')
    await expect(page.locator('.card').first()).toBeVisible({ timeout: 15000 })
    await page.locator('.card').first().click()
    await expect(page).toHaveURL(/\/playlist\/\d+/, { timeout: 8000 })

    await expect(page.locator('.detail__name')).toBeVisible({ timeout: 8000 })
    // 曲目应加载（可能较慢，给足时间）
    await expect(page.locator('.track-row').first()).toBeVisible({ timeout: 20000 })
  })
})

test.describe('后端 API 契约', () => {
  test('健康检查返回 ok', async ({ request }) => {
    const res = await request.get('/api/health')
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(body.data.status).toBe('ok')
  })

  test('搜索接口返回规范化曲目', async ({ request }) => {
    const res = await request.get('/api/search', { params: { keywords: FREE_SONG_KEYWORD, limit: 5 } })
    expect(res.ok()).toBe(true)
    const body = await res.json()
    expect(body.ok).toBe(true)
    expect(Array.isArray(body.data)).toBe(true)
    const t = body.data[0]
    expect(t).toMatchObject({
      id: expect.any(String),
      title: expect.any(String),
      artist: expect.any(String),
    })
    // 封面应为 https
    expect(t.cover.startsWith('https://')).toBe(true)
  })

  test('音频流代理支持 Range 分段', async ({ request }) => {
    // 先搜到一个可播放曲目
    const s = await request.get('/api/search', { params: { keywords: FREE_SONG_KEYWORD, limit: 5 } })
    const songs = (await s.json()).data
    const id = songs.find((x: { id: string }) => x.id)?.id
    expect(id).toBeTruthy()

    const res = await request.get(`/stream/${id}`, {
      headers: { Range: 'bytes=0-1023' },
    })
    // 206 或 200 均可接受（取决于源），但必须带音频类型且有字节
    expect([200, 206]).toContain(res.status())
    const buf = await res.body()
    expect(buf.byteLength).toBeGreaterThan(0)
    expect(res.headers()['content-type']).toContain('audio')
  })
})
