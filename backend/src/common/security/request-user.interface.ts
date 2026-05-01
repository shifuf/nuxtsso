export interface RequestUser {
  id: string;
  email: string;
  role: 'admin' | 'user';
  scopes: string[];
  clientId: string | null;
  token: string;
}
