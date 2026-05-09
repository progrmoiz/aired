export type JwtClaims = {
  sub: number;
  login: string;
  email: string | null;
  name: string | null;
  iat: number;
  exp: number;
  jti: string;
  v: 1;
};
