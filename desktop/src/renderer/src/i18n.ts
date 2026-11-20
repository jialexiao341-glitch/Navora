const translations: Record<string, Record<string, string>> = {
  zh: {
    status_starting: '正在启动 Agent...',
    status_starting_desc: '正在初始化客户端，请稍候',
    status_starting_slow: '启动比平时慢，仍在重试中...',
    status_reconnecting: '正在重新连接...',
    status_reconnecting_desc: '客户端程序无响应，正在自动重启',
    status_error: '初始化失败',
    status_error_desc: '客户端程序未能启动，无法连接',
    status_error_hint: '若重试无效，请打开日志目录查看 run.log，并反馈其中的报错信息。',
    status_error_file: '涉及的文件：',
    status_error_removed_desc: '客户端的核心程序文件不见了，其余文件都完好，这通常是被杀毒软件误判并删除或隔离了',
    status_error_removed_hint:
      '请在杀毒软件（如 Windows 安全中心、360、火绒、电脑管家）的「隔离区 / 病毒查杀记录」中找到上面这个文件并恢复，同时把客户端安装目录加入信任区，然后点击重试；若已无法恢复，重新安装客户端即可。',
    status_error_missing_desc: '客户端安装不完整，缺少核心程序文件',
    status_error_missing_hint: '请重新安装客户端。若重装后仍然缺失，多半是安装过程被杀毒软件拦截，请先将安装目录加入信任区再装一次。',
    status_error_blocked_desc: '核心程序文件存在，但系统拒绝运行它',
    status_error_blocked_hint: '通常是杀毒软件或系统安全策略拦截。请把客户端安装目录加入杀毒软件信任区后重试；若仍不行，请尝试以管理员身份启动客户端。',
    status_error_crashed_desc: '核心程序启动后异常退出',
    status_error_timeout_desc: '核心程序已启动，但长时间没有响应',
    status_error_unresponsive_desc: '客户端程序停止响应，且多次自动重启均未成功',
    status_retry: '重试',
    status_open_logs: '打开日志目录',
  },
  en: {
    status_starting: 'Starting Agent...',
    status_starting_desc: 'Initializing the client, please wait',
    status_starting_slow: 'Taking longer than usual, still retrying...',
    status_reconnecting: 'Reconnecting...',
    status_reconnecting_desc: 'The app stopped responding and is being restarted',
    status_error: 'Initialization Failed',
    status_error_desc: 'The app failed to start, so it cannot connect',
    status_error_hint: 'If retrying does not help, open the log folder, check run.log and report the error it shows.',
    status_error_file: 'File involved:',
    status_error_removed_desc:
      "The app's core program file is gone while everything around it is intact, which normally means antivirus software flagged it and deleted or quarantined it",
    status_error_removed_hint:
      'Find the file above in your antivirus quarantine (Windows Security, or whichever suite you use), restore it, add the installation folder to the trusted list, then retry. If it cannot be restored, reinstalling the app will replace it.',
    status_error_missing_desc: 'The installation is incomplete — its core program file is not there',
    status_error_missing_hint:
      'Reinstall the app. If the file is missing again afterwards, antivirus software is most likely blocking the installer: add the installation folder to its trusted list and install once more.',
    status_error_blocked_desc: 'The core program file is present, but the system refused to run it',
    status_error_blocked_hint:
      'This is usually antivirus software or a security policy. Add the installation folder to your antivirus trusted list and retry; if that does not help, try starting the app as an administrator.',
    status_error_crashed_desc: 'The core program started and then exited unexpectedly',
    status_error_timeout_desc: 'The core program started but never responded',
    status_error_unresponsive_desc: 'The app stopped responding and several automatic restarts did not bring it back',
    status_retry: 'Retry',
    status_open_logs: 'Open log folder',
  },
}

export type Lang = 'zh' | 'en'

// First-run default: follow the OS language so zh-* systems start in Chinese
// and everyone else in English. Once the user picks a language it's persisted
// in cow_lang and always wins. Falls back to 'en' when the locale is unknown.
function detectDefaultLang(): Lang {
  const locale = (window.electronAPI?.systemLocale || navigator.language || '').toLowerCase()
  return locale.startsWith('zh') ? 'zh' : 'en'
}

const savedLang = localStorage.getItem('cow_lang') as Lang | null
const currentLang: Lang = savedLang === 'zh' || savedLang === 'en' ? savedLang : detectDefaultLang()

export function t(key: string): string {
  return translations[currentLang]?.[key] || translations['en']?.[key] || key
}
