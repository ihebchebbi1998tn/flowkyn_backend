import cors from 'cors';
import { env } from './env';

// Support multiple CORS origins (comma-separated in env)
export const corsOptions: cors.CorsOptions = {
  origin: '*',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
};
