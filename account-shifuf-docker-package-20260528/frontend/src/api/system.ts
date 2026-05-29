import http from './http';
import type {
  JwksDocument,
  OidcDiscoveryDocument,
  ServiceRootInfo,
  SystemHealth,
} from '../types/api';

export const systemApi = {
  async getServiceRoot() {
    const { data } = await http.get('/api/service-info');
    return data as ServiceRootInfo;
  },
  async getHealth() {
    const { data } = await http.get('/api/health');
    return data as SystemHealth;
  },
  async getDiscovery() {
    const { data } = await http.get('/.well-known/openid-configuration');
    return data as OidcDiscoveryDocument;
  },
  async getJwks() {
    const { data } = await http.get('/oauth2/jwks');
    return data as JwksDocument;
  },
};
