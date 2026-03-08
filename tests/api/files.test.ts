/**
 * Files API tests
 * POST /v1/files
 * GET  /v1/files
 */

jest.mock('../../src/config/database', () => require('../mocks/database'));
jest.mock('../../src/services/email.service', () => require('../mocks/email'));
jest.mock('../../src/utils/upload', () => ({
  saveFile: jest.fn().mockReturnValue({
    filePath: '/tmp/test.jpg',
    fileName: 'test.jpg',
    url: 'http://localhost:3000/uploads/files/test.jpg',
  }),
  isAllowedFileType: jest.fn().mockReturnValue(true),
  isAllowedImageType: jest.fn().mockReturnValue(true),
}));

import '../setup';
import request from 'supertest';
import { app } from '../../src/app';
import { query } from '../../src/config/database';
import { authHeader, TEST_USER } from '../helpers';

const mockedQuery = query as jest.MockedFunction<typeof query>;

describe('Files API', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('GET /v1/files', () => {
    it('should list user files', async () => {
      mockedQuery.mockResolvedValueOnce([
        { id: 'f-1', url: 'http://localhost/uploads/files/a.jpg', file_type: 'image/jpeg', size: 1024 },
      ]);

      const res = await request(app)
        .get('/v1/files')
        .set('Authorization', authHeader());

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
    });

    it('should require authentication', async () => {
      const res = await request(app).get('/v1/files');
      expect(res.status).toBe(401);
    });
  });

  describe('POST /v1/files', () => {
    it('should reject upload without file', async () => {
      const res = await request(app)
        .post('/v1/files')
        .set('Authorization', authHeader());

      expect(res.status).toBe(400);
    });

    it('should upload file successfully', async () => {
      mockedQuery.mockResolvedValueOnce([{
        id: 'f-1', url: 'http://localhost:3000/uploads/files/test.jpg', file_type: 'image/jpeg', size: 1024,
      }]);

      const res = await request(app)
        .post('/v1/files')
        .set('Authorization', authHeader())
        .attach('file', Buffer.from('fake-image-data'), {
          filename: 'test.jpg',
          contentType: 'image/jpeg',
        });

      expect(res.status).toBe(201);
      expect(res.body).toHaveProperty('url');
    });
  });
});
