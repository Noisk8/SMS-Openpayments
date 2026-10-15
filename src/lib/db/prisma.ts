import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { getEnv } from "@/lib/config/env";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export function createPrismaClient(databaseUrl: string = getEnv().DATABASE_URL): PrismaClient {
  const adapter = new PrismaPg({ connectionString: databaseUrl });
  return new PrismaClient({ adapter });
}

/** Cliente singleton para el servidor de Next.js (evita abrir pools en cada recarga). */
export function getPrisma(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createPrismaClient();
  }
  return globalForPrisma.prisma;
}
