# Railway CLI Setup (Without Sudo)

## Option 1: Install Locally (Recommended)

Install Railway CLI in your home directory without needing sudo:

```bash
# Create a local bin directory
mkdir -p ~/.local/bin

# Configure npm to install global packages here
npm config set prefix ~/.local

# Install Railway CLI
npm install -g @railway/cli

# Add to PATH (add this to your ~/.bashrc or ~/.zshrc)
export PATH="$HOME/.local/bin:$PATH"

# Reload your shell config
source ~/.bashrc  # or source ~/.zshrc
```

## Option 2: Use npx (No Installation Needed)

You can use Railway CLI without installing it globally:

```bash
# Login
npx @railway/cli login

# Initialize project
npx @railway/cli init

# Deploy
npx @railway/cli up
```

## Option 3: Install with Sudo (If You Have Admin Access)

If you're comfortable using sudo:

```bash
sudo npm install -g @railway/cli
```

**Note**: The correct package name is `@railway/cli` (with the `@` symbol), not `railway/cli`.

## Quick Deploy Using npx

Since you're in the project directory, you can deploy immediately:

```bash
cd /home/rpretzer/usenet-newsreader

# Login to Railway (will open browser)
npx @railway/cli login

# Initialize and deploy
npx @railway/cli init
npx @railway/cli up
```

This avoids permission issues entirely!

