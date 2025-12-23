#!/bin/bash

# Railway Deployment Script
# Run this after you've logged in with: railway login

set -e

echo "🚂 Deploying to Railway..."
echo ""

# Check if logged in
if ! railway whoami &>/dev/null; then
    echo "❌ Not logged in to Railway"
    echo "Please run: railway login"
    echo "Then run this script again"
    exit 1
fi

echo "✅ Logged in to Railway"
echo ""

# Initialize if not already done
if [ ! -f .railway/project.json ]; then
    echo "📦 Initializing Railway project..."
    railway init --yes
else
    echo "✅ Project already initialized"
fi

echo ""
echo "🚀 Deploying application..."
railway up

echo ""
echo "✅ Deployment complete!"
echo ""
echo "Next steps:"
echo "1. Get your Railway URL from the output above"
echo "2. Update public/config.js with the URL"
echo "3. Run: git add public/config.js && git commit -m 'Configure Railway URL' && git push"

