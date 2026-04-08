const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const latestResponse = await prisma.response.findFirst({
    where: {
      analysisMeta: { not: null }
    },
    orderBy: {
      createdAt: 'desc'
    }
  });

  if (latestResponse) {
    console.log('LATEST_RESPONSE_FOUND');
    console.log(JSON.stringify(latestResponse.analysisMeta, null, 2));
  } else {
    console.log('NO_RESPONSE_WITH_META_FOUND');
  }
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
