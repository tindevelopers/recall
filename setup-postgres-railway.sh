#!/bin/bash
# Script to set up PostgreSQL database on Railway using CLI

cd /Users/gene/Projects/recall

echo "🐘 Setting up PostgreSQL Database on Railway"
echo "============================================="
echo ""

# Check if project is linked
if ! railway status &> /dev/null; then
    echo "❌ Project not linked. Linking now..."
    railway link --project recall
fi

echo "✅ Project linked: recall"
echo ""

# Check if PostgreSQL already exists
echo "🔍 Checking for existing PostgreSQL service..."
railway status

echo ""
echo "📋 To add PostgreSQL database, run this command:"
echo ""
echo "   railway add --database postgres"
echo ""
echo "This will:"
echo "  1. Create a PostgreSQL database service"
echo "  2. Automatically set DATABASE_URL environment variable"
echo "  3. Make it available to all services in your project"
echo ""
echo "⚠️  Note: This command requires interactive input."
echo "   When prompted, select 'Database' and 'PostgreSQL'"
echo ""

read -p "Do you want to run this command now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    echo ""
    echo "🚀 Adding PostgreSQL database..."
    railway add --database postgres
    echo ""
    echo "✅ PostgreSQL database added!"
    echo ""
    echo "📋 Next steps:"
    echo "=============="
    echo ""
    echo "1. Verify DATABASE_URL is set:"
    echo "   railway variables | grep DATABASE_URL"
    echo ""
    echo "2. Link to your main service to see all variables:"
    echo "   railway service <your-service-name>"
    echo "   railway variables"
    echo ""
    echo "3. Redeploy your application:"
    echo "   railway up"
    echo ""
    echo "4. Check logs to verify database connection:"
    echo "   railway logs --tail 50 | grep -i database"
else
    echo ""
    echo "To add PostgreSQL later, run:"
    echo "   railway add --database postgres"
fi


