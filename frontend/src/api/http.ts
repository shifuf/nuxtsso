import axios from 'axios';

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

const http = axios.create({
  baseURL: import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000',
  timeout: 15000,
});

http.interceptors.request.use((config) => {
  const rawSession = window.localStorage.getItem('sso-auth-session');

  if (rawSession) {
    try {
      const session = JSON.parse(rawSession) as { accessToken?: string };

      if (session.accessToken) {
        config.headers.Authorization = `Bearer ${session.accessToken}`;
      }
    } catch {
      window.localStorage.removeItem('sso-auth-session');
    }
  }

  return config;
});

http.interceptors.response.use(
  (res) => res,
  (error) => {
    if (error.response) {
      const backendMsg = error.response.data?.message;
      const msg = Array.isArray(backendMsg) ? backendMsg[0] : backendMsg;
      error.message = (typeof msg === 'string' && msg) || STATUS_MAP[error.response.status] || `请求失败（${error.response.status}）`;
    } else if (error.code === 'ECONNABORTED') {
      error.message = '请求超时';
    } else {
      error.message = '网络连接失败';
    }
    return Promise.reject(error);
  },
);

export default http;
