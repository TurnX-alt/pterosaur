import { useState } from "react";
import { Home, Compass, Radio, Heart, Clock, Disc3, Plus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useLibrary } from "../store/library.js";
import { useCreatePlaylist, useSidebarDrawer } from "../store/ui.js";
import { useViewNavigate } from "../hooks/useViewNavigate.js";
import { AppLink } from "./AppLink.js";
import { Cover } from "./Cover.js";
import "./Sidebar.css";

interface NavEntry {
  to: string;
  label: string;
  icon: LucideIcon;
  /** 是否仅精确匹配时高亮（用于根路由 `/`）。 */
  end?: boolean;
}

/** 主导航项。 */
const NAV: NavEntry[] = [
  { to: "/", label: "立即收听", icon: Home, end: true },
  { to: "/browse", label: "浏览", icon: Compass },
  { to: "/radio", label: "电台", icon: Radio },
];

/** 收藏相关入口（唱片盒只装收藏的专辑）。 */
const LIBRARY: NavEntry[] = [
  { to: "/crate", label: "唱片盒", icon: Disc3 },
  { to: "/favorites", label: "我喜欢的音乐", icon: Heart },
  { to: "/recent", label: "最近播放", icon: Clock },
];

/** 本项目 GitHub 地址。 */
const REPO_URL = "https://github.com/wpy030414/pterosaur";

/** GitHub 标记（lucide 1.x 已移除品牌图标，故内联 SVG）。 */
function GitHubMark() {
  return (
    <svg viewBox="0 0 16 16" width="18" height="18" fill="currentColor" aria-hidden focusable="false">
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

/**
 * 侧边栏。
 *
 * 功能保持单一、避免多入口：
 * - 「唱片盒」只展示收藏的专辑；
 * - 「歌单」同时列出我自建的歌单与收藏的歌单（两类之间以浅虚线分隔，不加文字）。
 */
export function Sidebar() {
  const playlists = useLibrary((s) => s.playlists);
  const savedPlaylists = useLibrary((s) => s.savedPlaylists);
  const openCreate = useCreatePlaylist((s) => s.openCreate);
  const sidebarOpen = useSidebarDrawer((s) => s.sidebarOpen);
  const setSidebarOpen = useSidebarDrawer((s) => s.setSidebarOpen);
  const navigate = useViewNavigate();

  // 点击标题切换：在品牌名与当前 commit 短哈希之间来回
  const [showHash, setShowHash] = useState(false);

  const handleCreate = () => {
    openCreate({ onDone: (id) => navigate(`/playlist/${id}`) });
  };

  const hasPlaylists = playlists.length > 0 || savedPlaylists.length > 0;

  return (
    <>
      {/* 窄屏半透明遮罩（点击关闭） */}
      <div
        className={`sidebar-scrim${sidebarOpen ? " sidebar-scrim--visible" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      <aside className={`sidebar${sidebarOpen ? " sidebar--drawer-open" : ""}`}>
        <div className="sidebar__brand">
          <button
            type="button"
            className="sidebar__name"
            onClick={() => setShowHash((v) => !v)}
            title={showHash ? "显示名称" : "显示当前 commit"}
          >
            {showHash ? __COMMIT_HASH__ : "Pterosaur"}
          </button>
          <a
            className="sidebar__github"
            href={REPO_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="在 GitHub 上查看本项目"
            title="GitHub"
          >
            <GitHubMark />
          </a>
        </div>

        <nav className="sidebar__nav" aria-label="主导航">
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <AppLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                `nav-item${isActive ? " nav-item--active" : ""}`
              }
            >
              <Icon size={19} strokeWidth={1.9} />
              <span className="nav-item__label">{label}</span>
            </AppLink>
          ))}
        </nav>

        <nav className="sidebar__nav" aria-label="我的音乐">
          {LIBRARY.map(({ to, label, icon: Icon }) => (
            <AppLink
              key={to}
              to={to}
              className={({ isActive }) =>
                `nav-item${isActive ? " nav-item--active" : ""}`
              }
            >
              <Icon size={19} strokeWidth={1.9} />
              <span className="nav-item__label">{label}</span>
            </AppLink>
          ))}
        </nav>

        <div className="sidebar__section-head">
          <span>歌单</span>
          <button
            type="button"
            className="sidebar__add"
            onClick={handleCreate}
            aria-label="新建歌单"
            title="新建歌单"
          >
            <Plus size={17} strokeWidth={2.2} />
          </button>
        </div>

        {hasPlaylists && (
          <nav className="sidebar__nav sidebar__playlists" aria-label="歌单">
            {playlists.map((p) => (
              <AppLink
                key={p.id}
                to={`/playlist/${p.id}`}
                className={({ isActive }) =>
                  `nav-item${isActive ? " nav-item--active" : ""}`
                }
              >
                <Cover
                  src={p.tracks[0]?.cover}
                  alt={p.name}
                  radius="sm"
                  size={19}
                />
                <span className="nav-item__label">{p.name}</span>
              </AppLink>
            ))}

            {playlists.length > 0 && savedPlaylists.length > 0 && (
              <div className="sidebar__playlist-divider" aria-hidden />
            )}

            {savedPlaylists.map((p) => (
              <AppLink
                key={p.id}
                to={`/playlist/${p.id}`}
                className={({ isActive }) =>
                  `nav-item${isActive ? " nav-item--active" : ""}`
                }
              >
                <Cover src={p.cover} alt={p.name} radius="sm" size={19} />
                <span className="nav-item__label">{p.name}</span>
              </AppLink>
            ))}
          </nav>
        )}
      </aside>
    </>
  );
}
