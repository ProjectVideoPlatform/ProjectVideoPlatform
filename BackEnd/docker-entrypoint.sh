#!/bin/sh
# ====== Docker Startup Script ======
# Runs Elasticsearch migration first, then starts the server

set -e  # Exit on error

echo "🚀 Starting server with Elasticsearch migration..."

# ===== STEP 1: Run Elasticsearch Migration =====
# echo "📋 Running Elasticsearch migration..."
# node scripts/es-migration.js --action sync --model all

# if [ $? -eq 0 ]; then
#     echo "✅ Elasticsearch migration completed successfully"
# else
#     echo "⚠️  Elasticsearch migration failed (non-fatal - continuing startup)"
# fi

# ===== STEP 2: Start Server =====
echo "🎯 Starting Node.js server..."
exec node server.js
