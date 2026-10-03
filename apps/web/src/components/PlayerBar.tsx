import { useCallback } from "react";
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  Volume2,
  VolumeX,
  Volume1,
  Heart,
  ListMusic,
  MoreHorizontal,
  Disc3,
} from "lucide-react";
import { usePlayer, currentPlayMode } from "../store/player.js";
import { useLibrary } from "../store/library.js";
import { useQueuePanel } from "../store/ui.js";
import { seekTo } from "../hooks/audioElement.js";
import { formatTime } from '@pterosaur/shared/types'
import { Cover } from "./Cover.js";
import { IconButton } from "./IconButton.js";
import { Slider } from "./Slider.js";
import { AddToPlaylistMenu } from "./AddToPlaylistMenu.js";
import { PLAY_MODE_META } from "./playMode.js";
import "./PlayerBar.css";

export function PlayerBar() {
  const current = usePlayer((s) => s.current);
  const isPlaying = usePlayer((s) => s.isPlaying);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const repeat = usePlayer((s) => s.repeat);
  const shuffle = usePlayer((s) => s.shuffle);
  const toggle = usePlayer((s) => s.toggle);
  const next = usePlayer((s) => s.next);
  const prev = usePlayer((s) => s.prev);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const cyclePlayMode = usePlayer((s) => s.cyclePlayMode);
  const setExpanded = usePlayer((s) => s.setExpanded);

  const favorites = useLibrary((s) => s.favorites);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const isFav = current ? favorites.some((t) => t.id === current.id) : false;

  const queueOpen = useQueuePanel((s) => s.queueOpen);
  const toggleQueue = useQueuePanel((s) => s.toggleQueue);

  // 拖拽进度：本地即时反馈，松手才真正 seek（避免频繁请求音频）
  const handleScrub = useCallback(() => {
    /* 拖拽中的值由 Slider 内部维护，这里无需处理 */
  }, []);

  const handleSeek = useCallback((v: number) => {
    seekTo(v);
  }, []);

  const VolumeIcon =
    muted || volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
  const mode = currentPlayMode(shuffle, repeat);
  const modeMeta = PLAY_MODE_META[mode];
  const ModeIcon = modeMeta.icon;

  return (
    <footer className="playerbar">
      {/* ---------- 左：曲目信息 ---------- */}
      <div className="playerbar__left">
        {current ? (
          <>
            <button
              type="button"
              className="playerbar__cover-btn"
              onClick={() => setExpanded(true)}
              aria-label="展开播放页"
            >
              <Cover
                src={current.cover}
                alt={current.title}
                radius="md"
                size={56}
              />
            </button>
            <div className="playerbar__meta">
              <div className="playerbar__title ellipsis">{current.title}</div>
              <div className="playerbar__artist ellipsis">{current.artist}</div>
            </div>
            <IconButton
              className="playerbar__fav-desktop"
              label={isFav ? "取消喜欢" : "喜欢"}
              size="sm"
              active={isFav}
              onClick={() => toggleFavorite(current)}
            >
              <Heart
                size={17}
                strokeWidth={2}
                fill={isFav ? "currentColor" : "none"}
              />
            </IconButton>
          </>
        ) : (
          <div className="playerbar__empty">
            <div className="playerbar__empty-cover">
              <Disc3 size={28} strokeWidth={1.5} />
            </div>
            <div className="playerbar__meta">
              <div className="playerbar__title">空空如也</div>
            </div>
          </div>
        )}
      </div>

      {/* ---------- 中：控制 + 进度 ---------- */}
      <div className="playerbar__center">
        <div className="playerbar__controls">
          {/* 播放模式：随机 / 循环合并为单一按钮，点击循环切换；靠专属图标区分状态 */}
          <IconButton
            label={`播放模式：${modeMeta.label}`}
            size="sm"
            onClick={cyclePlayMode}
          >
            <ModeIcon size={17} strokeWidth={2} />
          </IconButton>
          <IconButton
            label="上一首"
            size="md"
            onClick={prev}
            disabled={!current}
          >
            <SkipBack size={20} strokeWidth={2} fill="currentColor" />
          </IconButton>
          <IconButton
            label={isPlaying ? "暂停" : "播放"}
            size="lg"
            primary
            onClick={toggle}
            disabled={!current}
            data-testid="play-toggle"
          >
            {isPlaying ? (
              <Pause size={22} strokeWidth={2.2} fill="currentColor" />
            ) : (
              <Play size={22} strokeWidth={2.2} fill="currentColor" />
            )}
          </IconButton>
          <IconButton
            label="下一首"
            size="md"
            onClick={next}
            disabled={!current}
          >
            <SkipForward size={20} strokeWidth={2} fill="currentColor" />
          </IconButton>
          {/* 原循环按钮位置改为播放队列 */}
          <IconButton
            label={queueOpen ? "关闭播放队列" : "播放队列"}
            size="sm"
            active={queueOpen}
            onClick={toggleQueue}
          >
            <ListMusic size={17} strokeWidth={2} />
          </IconButton>
        </div>

        <div className="playerbar__progress">
          <span className="playerbar__time">{formatTime(position)}</span>
          <Slider
            value={position}
            max={duration || 0}
            onChange={handleScrub}
            onCommit={handleSeek}
            disabled={!current || !duration}
            ariaLabel="播放进度"
            size="sm"
          />
          <span className="playerbar__time">{formatTime(duration)}</span>
        </div>
      </div>

      {/* ---------- 右：音量 + 菜单（原「展开播放页」位置改放添加到歌单菜单） ---------- */}
      <div className="playerbar__right">
        <IconButton
          label={muted ? "取消静音" : "静音"}
          size="sm"
          onClick={toggleMute}
          disabled={!current}
        >
          <VolumeIcon size={17} strokeWidth={2} />
        </IconButton>
        <div className="playerbar__volume">
          <Slider
            value={muted ? 0 : volume}
            max={1}
            onChange={(v) => setVolume(v)}
            ariaLabel="音量"
            size="sm"
          />
        </div>
        {/* 移动端播放键（桌面端由 center 提供） */}
        <IconButton
          className="playerbar__play-mobile"
          label={isPlaying ? "暂停" : "播放"}
          size="sm"
          primary
          onClick={toggle}
          disabled={!current}
          data-testid="play-toggle-mobile"
        >
          {isPlaying ? (
            <Pause size={17} strokeWidth={2.2} fill="currentColor" />
          ) : (
            <Play size={17} strokeWidth={2.2} fill="currentColor" />
          )}
        </IconButton>
        {current && (
          <>
            <IconButton
              className="playerbar__fav-mobile"
              label={isFav ? "取消喜欢" : "喜欢"}
              size="sm"
              active={isFav}
              onClick={() => toggleFavorite(current)}
            >
              <Heart
                size={17}
                strokeWidth={2}
                fill={isFav ? "currentColor" : "none"}
              />
            </IconButton>
            <AddToPlaylistMenu track={current} direction="up">
              {({ onClick, open }) => (
                <IconButton
                  label="添加到歌单"
                  size="sm"
                  active={open}
                  onClick={onClick}
                >
                  <MoreHorizontal size={17} strokeWidth={2} />
                </IconButton>
              )}
            </AddToPlaylistMenu>
          </>
        )}
      </div>
    </footer>
  );
}
