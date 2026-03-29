/**
 * Global test setup — sets env vars BEFORE any module loads config/env.ts
 */
process.env.DATABASE_URL = 'postgres://test:test@localhost:5432/test';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-key-32chars!!';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-key-32chars!';
process.env.JWT_ACCESS_EXPIRES_IN = '15m';
process.env.JWT_REFRESH_EXPIRES_IN = '7d';
process.env.CORS_ORIGIN = '*';
process.env.NODE_ENV = 'test';
process.env.BASE_URL = 'http://localhost:3000';
process.env.UPLOADS_DIR = '/tmp/flowkyn_test_uploads';
