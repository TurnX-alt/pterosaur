import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
  Search,
  ChevronLeft,
  ChevronRight,
  Sun,
  Moon,
  User,
  LogOut,
  Menu,
  Settings,
  Cloud,
} from "lucide-react";
import { useTheme } from "../hooks/useTheme.js";
import { useViewNavigate } from "../hooks/useViewNavigate.js";
import { useAuth } from "../store/auth.js";
import { useSync } from "../store/sync.js";
import { syncNow } from "../lib/sync.js";
import { useSidebarDrawer, useSettingsDialog } from "../store/ui.js";
import { Cover } from "./Cover.js";
import "./Topbar.css";

interface TopbarProps {
  searchRef: React.RefObject<HTMLInputElement | null>;
}

/**
 * 顶部栏：前进/后退、全局搜索、主题切换、账户菜单。
 *
 * 采用半透明毛玻璃 + sticky，滚动时内容从其下方穿过。
 */
export function Topbar({ searchRef }: TopbarProps) {
  const navigate = useViewNavigate();
  const [params] = useSearchParams();
  const [keyword, setKeyword] = useState(params.get("q") ?? "");
  const mode = useTheme((s) => s.mode);
  const setMode = useTheme((s) => s.setMode);
  const status = useAuth((s) => s.status);
  const openModal = useAuth((s) => s.openModal);
  const logout = useAuth((s) => s.logout);
  const [menuOpen, setMenuOpen] = useState(false);
  const toggleSidebar = useSidebarDrawer((s) => s.toggleSidebar);
  const openSettings = useSettingsDialog((s) => s.openSettings);
  const syncEnabled = useSync((s) => s.enabled);

  /** 切换云同步开关：开启时绑定当前账号并立即同步一次。 */
  const toggleSync = () => {
    const store = useSync.getState();
    if (store.enabled) {
      store.disable();
    } else {
      store.enable(status.userId);
      void syncNow().catch((e) => console.warn("[sync] 首次同步失败", e));
    }
  };

  // URL 上的 q 变化时同步输入框（例如从其他页面跳来搜索）
  useEffect(() => {
    setKeyword(params.get("q") ?? "");
  }, [params]);

  // 点击外部关闭账户菜单
  useEffect(() => {
    if (!menuOpen) return;
    const close = () => setMenuOpen(false);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, [menuOpen]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const q = keyword.trim();
    if (!q) return;
    navigate(`/search?q=${encodeURIComponent(q)}`);
  };

  // 解析当前系统偏好下的「实际」明暗，用于决定切换目标与图标
  const prefersDark =
    mode === "system"
      ? (window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? true)
      : mode === "dark";

  const toggleTheme = () => setMode(prefersDark ? "light" : "dark");

  return (
    <header className="topbar">
      <button
        type="button"
        className="topbar__burger"
        onClick={toggleSidebar}
        aria-label="打开侧边栏"
      >
        <Menu size={20} strokeWidth={2} />
      </button>

      <div className="topbar__nav">
        <button
          type="button"
          className="topbar__round"
          onClick={() => navigate(-1)}
          aria-label="后退"
        >
          <ChevronLeft size={18} strokeWidth={2.4} />
        </button>
        <button
          type="button"
          className="topbar__round"
          onClick={() => navigate(1)}
          aria-label="前进"
        >
          <ChevronRight size={18} strokeWidth={2.4} />
        </button>
      </div>

      <form className="topbar__search" onSubmit={submit} role="search">
        <Search size={16} strokeWidth={2.2} className="topbar__search-icon" />
        <input
          ref={searchRef}
          type="search"
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          placeholder="搜索歌曲、艺人、专辑…"
          aria-label="搜索"
          data-testid="search-input"
          autoComplete="off"
          spellCheck={false}
        />
      </form>

      <div className="topbar__actions">
        <button
          type="button"
          className="topbar__round"
          onClick={toggleTheme}
          aria-label={prefersDark ? "切换到浅色" : "切换到深色"}
          title={prefersDark ? "浅色模式" : "深色模式"}
        >
          {prefersDark ? (
            <Sun size={17} strokeWidth={2} />
          ) : (
            <Moon size={17} strokeWidth={2} />
          )}
        </button>

        <button
          type="button"
          className="topbar__round"
          onClick={openSettings}
          aria-label="设置"
          title="设置"
          data-testid="settings-button"
        >
          <Settings size={17} strokeWidth={2} />
        </button>

        {status.logged ? (
          <div className="topbar__account">
            <button
              type="button"
              className="topbar__avatar"
              onClick={(e) => {
                e.stopPropagation();
                setMenuOpen((v) => !v);
              }}
              aria-label="账户菜单"
              aria-expanded={menuOpen}
            >
              <Cover
                src={status.avatarUrl}
                alt={status.nickname ?? "用户"}
                rounded
                size={28}
              />
            </button>
            {menuOpen && (
              <div
                className="topbar__menu"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="topbar__menu-head">
                  <Cover src={status.avatarUrl} alt="" rounded size={36} />
                  <div>
                    <div className="topbar__menu-name">{status.nickname}</div>
                    {status.vip && <div className="topbar__menu-plan">Pterosaur+</div>}
                  </div>
                </div>
                <button
                  type="button"
                  className="topbar__menu-item topbar__menu-item--switch"
                  onClick={toggleSync}
                  aria-pressed={syncEnabled}
                  data-testid="sync-toggle"
                >
                  <Cloud size={15} />
                  <span>{syncEnabled ? "云同步已开启" : "开启云同步"}</span>
                  <span
                    className={`topbar__switch${syncEnabled ? " topbar__switch--on" : ""}`}
                    aria-hidden
                  >
                    <span className="topbar__switch-knob" />
                  </span>
                </button>
                <button
                  type="button"
                  className="topbar__menu-item"
                  onClick={() => {
                    void logout();
                    setMenuOpen(false);
                  }}
                >
                  <LogOut size={15} /> 退出登录
                </button>
              </div>
            )}
          </div>
        ) : (
          <button type="button" className="topbar__login" onClick={openModal}>
            <User size={16} strokeWidth={2.1} />
            <span>登录</span>
          </button>
        )}
      </div>
    </header>
  );
}
