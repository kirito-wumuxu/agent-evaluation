import React, { useState, useEffect } from 'react';
import {
  Layers,
  Activity,
  Code2,
  Database,
  Server,
  ShieldCheck,
  Settings,
  Bot,
  Sparkles,
  LogIn,
  LogOut,
  User as UserIcon,
  ShieldAlert,
  ArrowRight,
  CheckCircle2,
  X,
  Lock,
  Eye,
  EyeOff,
  Terminal,
  KeyRound,
} from 'lucide-react';
import { TasksPage } from './pages/Tasks';
import { RunsPage } from './pages/Runs';
import { ScenariosPage } from './pages/Scenarios';
import { DatasetsPage } from './pages/Datasets';
import { EnvironmentsPage } from './pages/Environments';
import { EvaluatorsPage } from './pages/Evaluators';
import { SystemConfigsPage } from './pages/SystemConfigs';
import { AgentSkillModal } from './components/AgentSkillModal';
import { apiClient } from './api/client';
import { User, AuthConfig } from './types';

type TabType = 'tasks' | 'runs' | 'scenarios' | 'datasets' | 'environments' | 'evaluators' | 'settings';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<TabType>('tasks');
  const [selectedRunId, setSelectedRunId] = useState<number | null>(null);

  // 用户与认证状态
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [authConfig, setAuthConfig] = useState<AuthConfig | null>(null);
  const [showLoginModal, setShowLoginModal] = useState<boolean>(false);
  const [loginLoading, setLoginLoading] = useState<boolean>(false);
  const [showSkillModal, setShowSkillModal] = useState<boolean>(false);
  
  // 登录表单状态
  const [loginMethod, setLoginMethod] = useState<'password' | 'feishu'>('password');
  const [username, setUsername] = useState<string>('admin');
  const [password, setPassword] = useState<string>('');
  const [showPassword, setShowPassword] = useState<boolean>(false);
  const [loginError, setLoginError] = useState<string>('');

  const loadAuth = async () => {
    try {
      const cfg = await apiClient.getAuthConfig();
      setAuthConfig(cfg);

      const token = localStorage.getItem('eval_auth_token');
      if (token) {
        try {
          const user = await apiClient.getMe();
          setCurrentUser(user);
          localStorage.setItem('eval_user_name', user.name);
        } catch {
          localStorage.removeItem('eval_auth_token');
          localStorage.removeItem('eval_user_name');
          setCurrentUser(null);
          setShowLoginModal(true);
        }
      } else {
        setShowLoginModal(true);
      }
    } catch (e) {
      console.error('加载系统认证配置失败:', e);
    }
  };

  useEffect(() => {
    // 拦截飞书回调携带的 token 参数
    const params = new URLSearchParams(window.location.search);
    const token = params.get('token');
    if (token) {
      localStorage.setItem('eval_auth_token', token);
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    loadAuth();

    const handleExpired = () => {
      setCurrentUser(null);
      localStorage.removeItem('eval_user_name');
      setShowLoginModal(true);
    };
    window.addEventListener('auth_token_expired', handleExpired);
    return () => window.removeEventListener('auth_token_expired', handleExpired);
  }, []);

  const handlePasswordLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    setLoginLoading(true);
    try {
      const res = await apiClient.login(username.trim(), password);
      if (res && res.token) {
        localStorage.setItem('eval_auth_token', res.token);
        localStorage.setItem('eval_user_name', res.user.name);
        setCurrentUser(res.user);
        setShowLoginModal(false);
        setPassword('');
      }
    } catch (err: any) {
      setLoginError(err.message || '账号或密码错误，请检查控制台启动输出');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleFeishuLogin = async () => {
    setLoginLoading(true);
    try {
      const res = await apiClient.getFeishuAuthUrl();
      if (res && res.url) {
        window.location.href = res.url;
      }
    } catch (err: any) {
      alert('发起飞书登录失败: ' + err.message);
      setLoginLoading(false);
    }
  };

  const handleLogout = () => {
    apiClient.logout();
    localStorage.removeItem('eval_user_name');
    setCurrentUser(null);
    if (authConfig?.feishu_sso_enabled) {
      setShowLoginModal(true);
    }
  };

  const handleNavigateToRuns = (runId?: number) => {
    if (runId) setSelectedRunId(runId);
    setActiveTab('runs');
  };

  const navItems = [
    { key: 'tasks', label: '评测任务', icon: Layers, desc: '组合执行配方与触发评测' },
    { key: 'runs', label: '运行记录与复核', icon: Activity, desc: '批次进度与双轨人工复核' },
    { key: 'scenarios', label: '场景配置', icon: Code2, desc: 'Goja JS 沙箱调用脚本' },
    { key: 'datasets', label: '评测用例集', icon: Database, desc: '样本用例库与标准期望' },
    { key: 'environments', label: '环境配置', icon: Server, desc: '目标地址与密钥变量' },
    { key: 'evaluators', label: '评测模块', icon: ShieldCheck, desc: '规则 / LLM裁判 / JS脚本' },
    { key: 'settings', label: '系统配置', icon: Settings, desc: '全局裁判模型与并发设置' },
  ];

  const roleAllowedTabs: Record<string, TabType[]> = {
    admin: ['tasks', 'runs', 'scenarios', 'datasets', 'environments', 'evaluators', 'settings'],
    developer: ['tasks', 'runs', 'scenarios', 'datasets', 'environments', 'evaluators'],
    tester: ['tasks', 'runs', 'datasets'],
  };

  // 根据当前登录用户角色动态裁剪侧边导航
  const authorizedNavItems = navItems.filter((item) => {
    if (!currentUser) return false;
    const allowed = roleAllowedTabs[currentUser.role] || ['tasks', 'runs', 'datasets'];
    return allowed.includes(item.key as TabType);
  });

  // 角色变化时，若当前 Tab 不在授权清单中，自动回退到 tasks
  useEffect(() => {
    if (currentUser) {
      const allowed = roleAllowedTabs[currentUser.role] || ['tasks', 'runs', 'datasets'];
      if (!allowed.includes(activeTab)) {
        setActiveTab('tasks');
      }
    }
  }, [currentUser?.role]);

  const getRoleBadge = (role: string) => {
    switch (role) {
      case 'admin':
        return { label: '管理员', desc: '拥有全部系统权限', className: 'bg-blue-50 text-blue-700 border-blue-200' };
      case 'developer':
        return { label: '开发者', desc: '除系统配置外所有权限', className: 'bg-emerald-50 text-emerald-700 border-emerald-200' };
      case 'tester':
        return { label: '测试员', desc: '仅任务、用例集与复核', className: 'bg-purple-50 text-purple-700 border-purple-200' };
      default:
        return { label: role || '访客', desc: '基本访问', className: 'bg-gray-50 text-gray-700 border-gray-200' };
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 overflow-hidden font-sans">
      {/* 侧边导航栏 */}
      <aside className="w-64 bg-slate-900 text-slate-300 flex flex-col justify-between shrink-0 shadow-lg">
        <div>
          {/* 品牌标识 */}
          <div className="h-16 px-6 flex items-center gap-3 border-b border-slate-800 bg-slate-950/40">
            <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-blue-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-blue-500/20">
              <Bot className="w-5 h-5" />
            </div>
            <div>
              <h1 className="font-bold text-white text-base tracking-wide flex items-center gap-1.5">
                Agent 评测平台
              </h1>
              <span className="text-[10px] text-blue-400 font-mono tracking-wider uppercase">Goja Sandbox v1.0</span>
            </div>
          </div>

          {/* 导航菜单 */}
          <nav className="p-3 space-y-1">
            {authorizedNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.key;
              return (
                <button
                  key={item.key}
                  onClick={() => {
                    setActiveTab(item.key as TabType);
                    if (item.key === 'runs') setSelectedRunId(null);
                  }}
                  className={`w-full flex items-center gap-3 px-3.5 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-blue-600 text-white shadow-md shadow-blue-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span className="font-semibold">{item.label}</span>
                </button>
              );
            })}
          </nav>
        </div>

        {/* 底部技术栈说明 */}
        <div className="p-4 border-t border-slate-800/80 text-[11px] text-slate-500 space-y-1 bg-slate-950/20">
          <div className="flex items-center gap-1 text-slate-400 font-medium">
            <Sparkles className="w-3.5 h-3.5 text-blue-400" /> Golang + Gin + Goja
          </div>
          <div>SQLite3 WAL • React SPA</div>
        </div>
      </aside>

      {/* 主工作区 */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* 顶部状态栏 */}
        <header className="h-16 bg-white border-b border-gray-200/80 px-8 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold px-2.5 py-1 bg-blue-50 text-blue-700 rounded-md">
              当前控制台
            </span>
            <span className="text-sm font-medium text-gray-700">
              {navItems.find((n) => n.key === activeTab)?.label}
            </span>
            <span className="text-xs text-gray-400">
              — {navItems.find((n) => n.key === activeTab)?.desc}
            </span>
          </div>

          <div className="flex items-center gap-3 text-xs">
            {/* Agent Skill 顶部常驻入口 */}
            <button
              type="button"
              onClick={() => setShowSkillModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 border border-indigo-200/80 rounded-lg font-medium transition-all shadow-2xs hover:shadow-xs group cursor-pointer"
              title="查看与下载供 Claude Code 等编码 Agent 调用的评测 Skill"
            >
              <Bot className="w-3.5 h-3.5 text-indigo-600 group-hover:scale-110 transition-transform" />
              <span>Agent Skill 接入</span>
            </button>

            {/* 引擎状态 */}
            <div className="flex items-center gap-2 text-gray-500 bg-gray-50 px-2.5 py-1.5 rounded-lg border border-gray-100">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span>引擎在线: Goja 沙箱</span>
            </div>

            {/* 用户身份与登录态 */}
            {currentUser ? (
              <div className="flex items-center gap-3 pl-2 border-l border-gray-200">
                <div className="flex items-center gap-2.5">
                  {currentUser.avatar_url ? (
                    <img
                      src={currentUser.avatar_url}
                      alt={currentUser.name}
                      className="w-8 h-8 rounded-full border border-gray-200 object-cover shadow-sm bg-gray-100"
                    />
                  ) : (
                    <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center font-bold text-xs shadow-sm">
                      {currentUser.name.slice(0, 1)}
                    </div>
                  )}
                  <div>
                    <div className="font-semibold text-gray-800 text-xs flex items-center gap-1.5">
                      <span>{currentUser.name}</span>
                      {currentUser.username && (
                        <span className="text-[10px] text-gray-400 font-mono">@{currentUser.username}</span>
                      )}
                      <span className={`px-1.5 py-0.2 rounded text-[10px] font-mono border ${getRoleBadge(currentUser.role).className}`}>
                        {getRoleBadge(currentUser.role).label}
                      </span>
                    </div>
                    {currentUser.email && (
                      <div className="text-[10px] text-gray-400">{currentUser.email}</div>
                    )}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleLogout}
                  title="退出登录"
                  className="p-1.5 text-gray-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors ml-1"
                >
                  <LogOut className="w-4 h-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
                <button
                  type="button"
                  onClick={() => {
                    setLoginError('');
                    setShowLoginModal(true);
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-xs shadow-sm transition-all"
                >
                  <LogIn className="w-3.5 h-3.5" />
                  <span>登录账号</span>
                </button>
              </div>
            )}
          </div>
        </header>

        {/* 页面内容区 */}
        <main className="flex-1 overflow-y-auto p-8">
          {currentUser && !(roleAllowedTabs[currentUser.role] || []).includes(activeTab) ? (
            <div className="h-full flex items-center justify-center">
              <div className="max-w-md w-full bg-white border border-gray-200 rounded-2xl p-8 text-center shadow-sm space-y-4">
                <div className="w-14 h-14 mx-auto rounded-2xl bg-amber-50 text-amber-600 flex items-center justify-center">
                  <ShieldAlert className="w-8 h-8" />
                </div>
                <div>
                  <h3 className="text-lg font-bold text-gray-900">403 访问权限受限</h3>
                  <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                    当前登录角色为【{getRoleBadge(currentUser.role).label}】，无权访问此模块。<br />
                    {currentUser.role === 'developer' && '（开发者角色除系统全局配置外开放全部模块）'}
                    {currentUser.role === 'tester' && '（测试员角色仅开放评测任务、评测用例集、运行记录与复核）'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveTab('tasks')}
                  className="px-5 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-medium shadow-sm transition-all"
                >
                  返回我的可用控制台
                </button>
              </div>
            </div>
          ) : (
            <>
              {activeTab === 'tasks' && <TasksPage onNavigateToRuns={handleNavigateToRuns} />}
              {activeTab === 'runs' && <RunsPage initialSelectedRunId={selectedRunId} />}
              {activeTab === 'scenarios' && <ScenariosPage />}
              {activeTab === 'datasets' && <DatasetsPage />}
              {activeTab === 'environments' && <EnvironmentsPage />}
              {activeTab === 'evaluators' && <EvaluatorsPage />}
              {activeTab === 'settings' && <SystemConfigsPage />}
            </>
          )}
        </main>
      </div>

      {/* 统一登录弹窗 (账号密码登录 & 飞书 SSO) */}
      {showLoginModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl border border-gray-200 w-full max-w-md overflow-hidden animate-in fade-in zoom-in-95 duration-200">
            {/* 弹窗头部 */}
            <div className="px-6 pt-6 pb-4 bg-gradient-to-b from-blue-50/50 to-white flex items-start justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-blue-600 text-white flex items-center justify-center shadow-md shadow-blue-500/20">
                  <Bot className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="font-bold text-gray-900 text-base">登录 Agent 评测平台</h3>
                  <p className="text-xs text-gray-500 mt-0.5">支持预置账号与企业飞书单点登录</p>
                </div>
              </div>
              {!authConfig?.feishu_sso_enabled && (
                <button
                  type="button"
                  onClick={() => setShowLoginModal(false)}
                  className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100"
                >
                  <X className="w-5 h-5" />
                </button>
              )}
            </div>

            {/* 登录方式切换 Tab */}
            <div className="px-6 border-b border-gray-100 flex gap-4 text-xs font-semibold">
              <button
                type="button"
                onClick={() => setLoginMethod('password')}
                className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
                  loginMethod === 'password'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                <KeyRound className="w-3.5 h-3.5" />
                <span>账号密码登录</span>
              </button>
              <button
                type="button"
                onClick={() => setLoginMethod('feishu')}
                className={`pb-2.5 border-b-2 transition-colors flex items-center gap-1.5 ${
                  loginMethod === 'feishu'
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-400 hover:text-gray-600'
                }`}
              >
                <svg className="w-3.5 h-3.5 fill-current" viewBox="0 0 24 24">
                  <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.93V18c0 .55-.45 1-1 1s-1-.45-1-1v-1.07c-2.83-.48-5-2.94-5-5.93 0-.55.45-1 1-1s1 .45 1 1c0 2.21 1.79 4 4 4s4-1.79 4-4c0-.55.45-1 1-1s1 .45 1 1c0 2.99-2.17 5.45-5 5.93zM12 6c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3z"/>
                </svg>
                <span>飞书 SSO 授权</span>
              </button>
            </div>

            <div className="p-6">
              {loginError && (
                <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-xl text-rose-700 text-xs flex items-center gap-2">
                  <ShieldAlert className="w-4 h-4 shrink-0 text-rose-600" />
                  <span>{loginError}</span>
                </div>
              )}

              {/* Tab 1: 账号密码登录 */}
              {loginMethod === 'password' && (
                <form onSubmit={handlePasswordLogin} className="space-y-4">
                  {/* 快捷选择预置账号 */}
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1.5">
                      选择预置账号或输入账号:
                    </label>
                    <div className="grid grid-cols-3 gap-2 mb-2">
                      <button
                        type="button"
                        onClick={() => {
                          setUsername('admin');
                          setLoginError('');
                        }}
                        className={`py-1.5 px-2 rounded-lg text-xs font-medium border text-center transition-all ${
                          username === 'admin'
                            ? 'bg-blue-50 border-blue-300 text-blue-700 shadow-sm'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <div className="font-bold">admin</div>
                        <div className="text-[10px] text-blue-600/80 font-medium">管理员 • 全量权限</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setUsername('developer');
                          setLoginError('');
                        }}
                        className={`py-2 px-2 rounded-lg text-xs font-medium border text-center transition-all ${
                          username === 'developer'
                            ? 'bg-emerald-50 border-emerald-300 text-emerald-700 shadow-sm'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <div className="font-bold">developer</div>
                        <div className="text-[10px] text-emerald-600/80 font-medium">开发者 • 排除配置</div>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setUsername('tester');
                          setLoginError('');
                        }}
                        className={`py-2 px-2 rounded-lg text-xs font-medium border text-center transition-all ${
                          username === 'tester'
                            ? 'bg-purple-50 border-purple-300 text-purple-700 shadow-sm'
                            : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                        }`}
                      >
                        <div className="font-bold">tester</div>
                        <div className="text-[10px] text-purple-600/80 font-medium">测试员 • 任务/用例/复核</div>
                      </button>
                    </div>

                    <div className="relative">
                      <UserIcon className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                      <input
                        type="text"
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        placeholder="输入账号用户名 (admin / developer / tester)"
                        required
                        className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white font-medium"
                      />
                    </div>
                  </div>

                  {/* 密码输入框 */}
                  <div>
                    <label className="block text-[11px] font-semibold text-gray-500 mb-1.5">
                      密码:
                    </label>
                    <div className="relative">
                      <Lock className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                      <input
                        type={showPassword ? 'text' : 'password'}
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        placeholder="输入对应的登录密码"
                        required
                        className="w-full pl-9 pr-9 py-2 border border-gray-300 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-blue-500 bg-gray-50/50 focus:bg-white font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="p-1.5 text-gray-400 hover:text-gray-600 absolute right-2 top-1.5 rounded"
                      >
                        {showPassword ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                      </button>
                    </div>
                  </div>

                  {/* 控制台密码提示说明 */}
                  <div className="p-3 bg-slate-900 text-slate-300 rounded-xl text-[11px] font-mono flex items-start gap-2.5 border border-slate-800">
                    <Terminal className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="text-white font-bold flex items-center gap-1">
                        <span>控制台凭证提示</span>
                      </div>
                      <div className="text-slate-400 text-[10px] mt-0.5 leading-relaxed">
                        预置账号的默认密码已在后台启动服务时打印输出至标准控制台日志。请查看命令行获取。
                      </div>
                    </div>
                  </div>

                  {/* 登录提交按钮 */}
                  <button
                    type="submit"
                    disabled={loginLoading}
                    className="w-full py-2.5 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-xl font-medium text-xs shadow-md shadow-blue-500/20 transition-all flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <span>{loginLoading ? '正在校验凭据...' : '立即登录'}</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </form>
              )}

              {/* Tab 2: 飞书 SSO 登录 */}
              {loginMethod === 'feishu' && (
                <div className="space-y-4">
                  {authConfig?.configured ? (
                    <button
                      type="button"
                      onClick={handleFeishuLogin}
                      disabled={loginLoading}
                      className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-[#3370FF] hover:bg-[#2860E1] text-white rounded-xl font-medium text-sm shadow-md shadow-blue-500/20 transition-all disabled:opacity-50"
                    >
                      <svg className="w-5 h-5 fill-current" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 14.93V18c0 .55-.45 1-1 1s-1-.45-1-1v-1.07c-2.83-.48-5-2.94-5-5.93 0-.55.45-1 1-1s1 .45 1 1c0 2.21 1.79 4 4 4s4-1.79 4-4c0-.55.45-1 1-1s1 .45 1 1c0 2.99-2.17 5.45-5 5.93zM12 6c1.66 0 3 1.34 3 3s-1.34 3-3 3-3-1.34-3-3 1.34-3 3-3z"/>
                      </svg>
                      <span>通过飞书账号一键授权登录</span>
                    </button>
                  ) : (
                    <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-xs space-y-1">
                      <div className="font-semibold flex items-center gap-1.5">
                        <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0" />
                        <span>尚未配置飞书 App ID</span>
                      </div>
                      <p className="text-[11px] text-amber-700 leading-relaxed">
                        可先使用「账号密码登录」进入系统，在「系统配置」中配置飞书应用凭据后启用 SSO。
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 编码 Agent Skill 接入指引与离线包下载弹窗 */}
      <AgentSkillModal isOpen={showSkillModal} onClose={() => setShowSkillModal(false)} />
    </div>
  );
};
