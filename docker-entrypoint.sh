#!/bin/sh
set -e

# /data is a bind mount on most NAS setups, so its ownership comes from the
# host, not the image — fix it up on every start before dropping to nextjs.
mkdir -p /data/uploads /data/models /data/backups
chown -R nextjs:nodejs /data

gosu nextjs npx prisma migrate deploy
gosu nextjs npx tsx prisma/seed.ts

exec gosu nextjs node server.js
