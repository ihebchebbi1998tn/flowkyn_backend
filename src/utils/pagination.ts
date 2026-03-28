import { PaginationQuery, PaginatedResponse } from '../types';

export function parsePagination(query: PaginationQuery): { page: number; limit: number; offset: number } {
  const page = Math.max(1, query.page || 1);
  const limit = Math.min(100, Math.max(1, query.limit || 20));
  const offset = (page - 1) * limit;
  return { page, limit, offset };
}

export function buildPaginatedResponse<T>(data: T[], total: number, page: number, limit: number): PaginatedResponse<T> {
  return {
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
}
