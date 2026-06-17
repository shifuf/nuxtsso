import axios, { type AxiosError, type InternalAxiosRequestConfig } from 'axios';

const STATUS_MAP: Record<number, string> = {
  400: '请求参数错误',
  401: '未授权或登录已过期',
  403: '权限不足',
  404: '请求的资源不存在',
  409: '数据冲突',
  422: '请求参数校验失败',
  429: '请求过于频繁，请稍后再试',
  500: '服务器内部错误',
  502: '服务不可用',
  503: '服务暂时不可用',
};

interface RetryableRequestConfig extends InternalAxiosRequestConfig {
  _authRetry?: boolean;
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1']);

function resolveApiBaseUrl() {
  const raw = (import.meta.env.VITE_API_BASE_URL ?? '').trim();
  if (!raw || !/^https?:\/\//i.test(raw) || typeof window === 'undefined') {
    return raw;
  }

  try {
    const url = new URL(raw);
    const currentHost = window.location.hostname;
    if (
      import.meta.env.DEV &&
      LOOPBACK_HOSTS.has(url.hostname) &&
      LOOPBACK_HOSTS.has(currentHost) &&
      url.hostname !== currentHost
    ) {
      url.hostname = currentHost;
      return url.toString().replace(/\/$/, '');
    }
  } catch {
    return raw;
  }

  return raw;
}

const API_BASE_URL = resolveApiBaseUrl();
const AUTH_REFRESH_SKIP_PATHS = new Set([
  '/api/auth/refresh',
  '/api/auth/login',
  '/api/auth/login-email',
  '/api/auth/register',
  '/api/auth/public-register',
  '/api/auth/logout',
  '/oauth2/token',
]);

const http = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
});

const refreshClient = axios.create({
  baseURL: API_BASE_URL,
  timeout: 15000,
  withCredentials: true,
});

let refreshPromise: Promise<void> | null = null;

function resolveRequestPath(config: InternalAxiosRequestConfig) {
  const rawUrl = config.url ?? '';
  try {
    return new URL(rawUrl, API_BASE_URL || window.location.origin).pathname;
  } catch {
    return rawUrl.split('?')[0];
  }
}

function canRefresh(error: AxiosError) {
  if (error.response?.status !== 401 || !error.config) {
    return false;
  }

  const config = error.config as RetryableRequestConfig;
  return !config._authRetry && !AUTH_REFRESH_SKIP_PATHS.has(resolveRequestPath(config));
}

async function refreshAccessToken() {
  refreshPromise ??= refreshClient
    .post('/api/auth/refresh')
    .then(() => undefined)
    .finally(() => {
      refreshPromise = null;
    });
  return refreshPromise;
}

function normalizeErrorMessage(error: AxiosError) {
  if (error.response) {
    const backendMsg = (error.response.data as { message?: unknown } | undefined)?.message;
    const msg = Array.isArray(backendMsg) ? backendMsg[0] : backendMsg;
    error.message = (typeof msg === 'string' && msg) || STATUS_MAP[error.response.status] || `请求失败（${error.response.status}）`;
  } else if (error.code === 'ECONNABORTED') {
    error.message = '请求超时';
  } else {
    error.message = '网络连接失败';
  }
}

http.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    if (canRefresh(error)) {
      const config = error.config as RetryableRequestConfig;
      config._authRetry = true;
      try {
        await refreshAccessToken();
        return http(config);
      } catch {
        // Fall through and report the original protected request as expired.
      }
    }

    normalizeErrorMessage(error);
    return Promise.reject(error);
  },
);

export default http;
