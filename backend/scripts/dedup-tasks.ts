/// <reference types="node" />

/**
 * One-time cleanup: remove duplicate tasks produced by multiple AI-extraction runs.
 *
 * Dedup key: (meetingId, title) — assignedToId is intentionally excluded because
 * PostgreSQL treats each NULL as distinct, so a nullable column in a UNIQUE
 * constraint does not prevent NULL-NULL duplicate rows.
 *
 * Run BEFORE `prisma migrate dev --name add_ai_status_unique`
 * so the unique constraint migration does not fail on existing duplicates.
 *
 *   cd backend
 *   npx ts-node --transpile-only --project tsconfig.json scripts/dedup-tasks.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
    console.log('=== Task deduplication script ===\n');

    // 1. Find all (meetingId, title) groups that have more than one row
    const duplicateGroups = await prisma.$queryRaw<
        Array<{ meetingId: string; title: string; total: bigint }>
    >`
        SELECT "meetingId", title, COUNT(*) AS total
        FROM   tasks
        GROUP  BY "meetingId", title
        HAVING COUNT(*) > 1
    `;

    if (duplicateGroups.length === 0) {
        console.log('No duplicate tasks found. Nothing to do.');
        return;
    }

    console.log(`Found ${duplicateGroups.length} duplicate group(s):\n`);
    for (const g of duplicateGroups) {
        console.log(`  meetingId=${g.meetingId}  title="${g.title}"  copies=${Number(g.total)}`);
    }
    console.log();

    // 2. For each group: keep the earliest createdAt, collect IDs to delete
    const idsToDelete: string[] = [];

    for (const { meetingId, title } of duplicateGroups) {
        const rows = await prisma.task.findMany({
            where: { meetingId, title },
            orderBy: { createdAt: 'asc' },
            select: { id: true },
        });

        // First row = keeper. The rest are duplicates.
        const [, ...dupes] = rows;
        for (const d of dupes) {
            idsToDelete.push(d.id);
        }
    }

    console.log(`Deleting ${idsToDelete.length} duplicate task(s)...`);

    // 3. Hard-delete in batches of 100
    const BATCH = 100;
    let deleted = 0;
    for (let i = 0; i < idsToDelete.length; i += BATCH) {
        const batch = idsToDelete.slice(i, i + BATCH);
        const { count } = await prisma.task.deleteMany({ where: { id: { in: batch } } });
        deleted += count;
    }

    console.log(`Deleted ${deleted} duplicate task(s).`);
    console.log('\nNext step: npx prisma migrate dev --name add_ai_status_unique');
    console.log('=== Done ===\n');
}

main()
    .catch((err) => { console.error(err); process.exit(1); })
    .finally(() => prisma.$disconnect());
