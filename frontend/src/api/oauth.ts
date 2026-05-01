import http from './http';
import type { AuthorizeContext, TokenSet } from '../types/api';

export interface AuthorizeDecisionPayload {
  client_id: string;
  redirect_uri: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: 'S256' | 'plain';
  nonce?: string;
  decision: 'approve' | 'deny';
}

export interface TokenPayload {
  grant_type: 'authorization_code' | 'refresh_token';
  client_id: string;
  client_secret?: string;
  code?: string;
  redirect_uri?: string;
  code_verifier?: string;
  refresh_token?: string;
}

export const oauthApi = {
  async getAuthorizeContext(params: Record<string, string | undefined>) {
    const { data } = await http.get('/oauth2/authorize', { params });
    return data as AuthorizeContext;
  },
  async authorize(payload: AuthorizeDecisionPayload) {
    const { data } = await http.post('/oauth2/authorize', payload);
    return data as {
      code?: string;
      redirectTo: string;
    };
  },
  async validateClient(clientId: string, clientSecret: string) {
    const { data } = await http.post('/oauth2/validate-client', {
      client_id: clientId,
      client_secret: clientSecret,
    });
    return data as { valid: boolean };
  },
  async exchangeToken(payload: TokenPayload) {
    const body = new URLSearchParams();

    Object.entries(payload).forEach(([key, value]) => {
      if (value) {
        body.set(key, value);
      }
    });

    const { data } = await http.post('/oauth2/token', body, {
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
    });

    return data as TokenSet;
  },
};
