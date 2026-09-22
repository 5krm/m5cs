import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

let db: PrismaClient
try {
  db =
    globalForPrisma.prisma ??
    new PrismaClient({
      log: ['query'],
    })
  if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
} catch {
  console.warn('[AI Studio] Database not connected — using mock')
  const noOp = {
    findMany: async () => [],
    findFirst: async () => null,
    findUnique: async () => null,
    create: async (d: any) => d?.data ?? {},
    update: async (d: any) => d?.data ?? {},
    delete: async () => ({}),
  }
  db = new Proxy({}, { get: () => noOp }) as unknown as PrismaClient
}

export { db }
