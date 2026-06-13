"""
Setup script for MarkItDown Website Backend.

This script creates a Python virtual environment and installs dependencies.
Run it from the backend/ directory:

    python setup.py
"""

import os
import subprocess
import sys
from pathlib import Path


def setup_virtual_environment():
    """Create and set up Python virtual environment."""
    venv_path = Path("venv")

    print("Setting up MarkItDown Website Backend...")
    print("-" * 50)

    # Create virtual environment
    if not venv_path.exists():
        print("Creating virtual environment...")
        subprocess.run([sys.executable, "-m", "venv", "venv"], check=True)
        print("OK Virtual environment created")
    else:
        print("OK Virtual environment already exists")

    # Determine pip/python paths based on OS
    if os.name == "nt":  # Windows
        pip_path = venv_path / "Scripts" / "pip.exe"
        python_path = venv_path / "Scripts" / "python.exe"
    else:  # Unix/Linux/Mac
        pip_path = venv_path / "bin" / "pip"
        python_path = venv_path / "bin" / "python"

    # Upgrade pip
    print("\nUpgrading pip...")
    subprocess.run(
        [str(python_path), "-m", "pip", "install", "--upgrade", "pip"],
        check=True,
    )
    print("OK pip upgraded")

    # Install dependencies
    print("\nInstalling dependencies from requirements.txt...")
    subprocess.run([str(pip_path), "install", "-r", "requirements.txt"], check=True)
    print("OK Dependencies installed")

    # Create .env file if it doesn't exist
    env_file = Path(".env")
    env_example = Path(".env.example")

    if not env_file.exists() and env_example.exists():
        print("\nCreating .env file from .env.example...")
        env_file.write_text(env_example.read_text())
        print("OK .env file created")

    print("\n" + "=" * 50)
    print("Setup complete!")
    print("=" * 50)
    print("\nTo activate the virtual environment:")
    if os.name == "nt":
        print("  .\\venv\\Scripts\\activate")
    else:
        print("  source venv/bin/activate")
    print("\nTo run the development server (after main.py is implemented):")
    print("  uvicorn app.main:app --reload")


if __name__ == "__main__":
    try:
        setup_virtual_environment()
    except subprocess.CalledProcessError as e:
        print(f"\nError during setup: {e}", file=sys.stderr)
        sys.exit(1)
    except Exception as e:
        print(f"\nUnexpected error: {e}", file=sys.stderr)
        sys.exit(1)
