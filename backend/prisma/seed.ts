import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    const adminPassword = process.env.SEED_ADMIN_PASSWORD;

    if (!adminEmail || !adminPassword) {
        console.info('Skipping seed: SEED_ADMIN_EMAIL or SEED_ADMIN_PASSWORD not configured.');
        return;
    }

    await prisma.user.upsert({
        where: { email: adminEmail },
        update: {
            role: 'admin',
            isActive: true,
        },
        create: {
            email: adminEmail,
            password: adminPassword,
            name: 'Admin User',
            role: 'admin',
            isActive: true,
            isEmailVerified: true,
        },
    });

    console.info(`Seed completed for admin: ${adminEmail}`);
}

main()
    .catch((error) => {
        console.error('Seed failed:', error);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
