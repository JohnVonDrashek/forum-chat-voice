#!/bin/bash
# Setup script for Forumline Demo - Supabase integration
# Run this after `supabase login` to create and configure everything

set -e

echo "🚀 Forumline Demo - Supabase Setup"
echo "======================================"

# Check if logged in
if ! supabase projects list &>/dev/null; then
    echo "❌ Not logged into Supabase. Run 'supabase login' first."
    exit 1
fi

# Get project name
PROJECT_NAME="${1:-forum-chat-voice}"
GITHUB_REPO="JohnVonDrashek/forum-chat-voice"

echo ""
echo "📦 Creating Supabase project: $PROJECT_NAME"
echo "   (This may take a minute...)"

# Create the project (us-east-1 is free tier friendly)
PROJECT_INFO=$(supabase projects create "$PROJECT_NAME" \
    --org-id "$(supabase orgs list --json | jq -r '.[0].id')" \
    --region us-east-1 \
    --json 2>/dev/null || echo "")

if [ -z "$PROJECT_INFO" ]; then
    echo "⚠️  Project may already exist. Trying to find it..."
    PROJECT_INFO=$(supabase projects list --json | jq -r ".[] | select(.name==\"$PROJECT_NAME\")")
fi

PROJECT_ID=$(echo "$PROJECT_INFO" | jq -r '.id // .ref')
echo "✅ Project ID: $PROJECT_ID"

# Wait for project to be ready
echo ""
echo "⏳ Waiting for project to be ready..."
sleep 30

# Get project credentials
echo ""
echo "🔑 Fetching credentials..."
API_URL=$(supabase projects show "$PROJECT_ID" --json | jq -r '.api.url')
ANON_KEY=$(supabase projects show "$PROJECT_ID" --json | jq -r '.api.anon_key')

echo "   URL: $API_URL"
echo "   Key: ${ANON_KEY:0:20}..."

# Apply database schema
echo ""
echo "🗄️  Applying database schema..."
supabase db push --project-ref "$PROJECT_ID" < supabase/schema.sql

# Set GitHub secrets
echo ""
echo "🔒 Setting GitHub secrets..."
if command -v gh &>/dev/null; then
    echo "$API_URL" | gh secret set VITE_SUPABASE_URL --repo "$GITHUB_REPO"
    echo "$ANON_KEY" | gh secret set VITE_SUPABASE_ANON_KEY --repo "$GITHUB_REPO"
    echo "✅ GitHub secrets configured!"

    # Trigger a new deployment
    echo ""
    echo "🚀 Triggering deployment..."
    gh workflow run deploy.yml --repo "$GITHUB_REPO" 2>/dev/null || \
        echo "   (Push a commit to trigger deployment)"
else
    echo "⚠️  GitHub CLI not found. Set these secrets manually:"
    echo "   VITE_SUPABASE_URL=$API_URL"
    echo "   VITE_SUPABASE_ANON_KEY=$ANON_KEY"
fi

# Create local .env file
echo ""
echo "📝 Creating local .env.local..."
cat > .env.local << EOF
VITE_SUPABASE_URL=$API_URL
VITE_SUPABASE_ANON_KEY=$ANON_KEY
EOF
echo "✅ Local environment configured!"

echo ""
echo "======================================"
echo "🎉 Setup complete!"
echo ""
echo "Your forum is ready at:"
echo "   https://johnvondrashek.github.io/forum-chat-voice/"
echo ""
echo "Supabase dashboard:"
echo "   https://supabase.com/dashboard/project/$PROJECT_ID"
echo ""
