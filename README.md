# MarkItDown Website - Backend

Python FastAPI backend for converting various file formats to Markdown using the MarkItDown library.

## Project Structure

```
.
├── app/
│   ├── __init__.py          # Application package
│   ├── config.py            # Configuration management
│   ├── main.py              # FastAPI application entry point
│   ├── api/                 # API endpoints
│   │   └── __init__.py
│   ├── models/              # Pydantic models
│   │   └── __init__.py
│   ├── services/            # Business logic
│   │   └── __init__.py
│   └── utils/               # Utility functions
│       └── __init__.py
├── temp/                    # Temporary file storage (auto-created)
├── requirements.txt         # Python dependencies
├── .env.example             # Example environment configuration
├── .env                     # Local environment configuration (create from .env.example)
└── setup.py                 # Virtual environment setup script
```

## Prerequisites

- Python 3.10 or higher
- pip (Python package manager)

## Setup

### Automated Setup

Run the setup script to create a virtual environment and install dependencies:

```bash
python setup.py
```

This will:
1. Create a Python virtual environment in `./venv`
2. Upgrade pip to the latest version
3. Install all dependencies from `requirements.txt`
4. Create a `.env` file from `.env.example` if it doesn't exist

### Manual Setup

If you prefer manual setup:

1. **Create virtual environment:**
   ```bash
   python -m venv venv
   ```

2. **Activate virtual environment:**
   - Windows:
     ```bash
     .\venv\Scripts\activate
     ```
   - Unix/Linux/Mac:
     ```bash
     source venv/bin/activate
     ```

3. **Install dependencies:**
   ```bash
   pip install -r requirements.txt
   ```

4. **Configure environment:**
   ```bash
   cp .env.example .env
   # Edit .env with your settings
   ```

## Configuration

The application is configured through environment variables. See `.env.example` for available options:

### Core Settings

- `MAX_FILE_SIZE`: Maximum upload file size in bytes (default: 50MB)
- `CONVERSION_TIMEOUT`: Maximum conversion time in seconds (default: 30)
- `MAX_CONCURRENT_CONVERSIONS`: Maximum simultaneous conversions (default: 5)
- `TEMP_STORAGE_PATH`: Path for temporary file storage (default: ./temp)
- `RESULT_RETENTION_HOURS`: Hours to retain conversion results (default: 1)

### CORS Settings

- `CORS_ORIGINS`: Comma-separated list of allowed origins for CORS

### Azure AI Services (Optional)

For enhanced conversion quality with cloud services:

- `AZURE_DI_ENDPOINT`: Azure Document Intelligence endpoint
- `AZURE_DI_KEY`: Azure Document Intelligence API key
- `AZURE_CU_ENDPOINT`: Azure Content Understanding endpoint
- `AZURE_CU_KEY`: Azure Content Understanding API key

## Running the Application

### Development Server

```bash
uvicorn app.main:app --reload
```

The API will be available at `http://localhost:8000`

### Production Server

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8000 --workers 4
```

## Dependencies

### Core Dependencies

- **FastAPI** (0.115.0): Modern web framework for building APIs
- **Uvicorn** (0.32.0): ASGI server for running FastAPI applications
- **Python-Multipart** (0.0.12): Multipart form data parsing for file uploads
- **Pydantic** (2.9.2): Data validation using Python type annotations
- **Pydantic-Settings** (2.6.1): Settings management with Pydantic
- **MarkItDown** (0.0.1a2): Core library for file-to-markdown conversion
- **Python-Dotenv** (1.0.1): Environment variable management

### Optional Dependencies

- **Azure AI Document Intelligence**: Enhanced PDF and document conversion
- **Azure AI Inference**: Advanced content understanding

## API Endpoints

The following endpoints will be implemented:

- `POST /api/convert` - Convert uploaded files to markdown
- `GET /api/download/{result_id}` - Download converted markdown file
- `GET /api/health` - System health check and supported formats

## Supported File Formats

- **Documents**: PDF, DOCX, PPTX, XLSX
- **Images**: PNG, JPG, JPEG, GIF
- **Audio**: MP3, WAV (with speech-to-text)
- **Web**: HTML, HTM
- **Archives**: ZIP (processes contained files)

## Development

### Project Requirements

This backend satisfies the following requirements:

- **18.1**: Configuration from environment variables (MAX_FILE_SIZE, CONVERSION_TIMEOUT, etc.)
- **18.2**: Default values for all configuration parameters
- **18.5**: Configuration of temporary storage location

### Next Steps

1. Implement API endpoints (`/api/convert`, `/api/download`, `/api/health`)
2. Create Pydantic models for request/response validation
3. Implement file processing service with MarkItDown integration
4. Add security features (MIME type validation, rate limiting)
5. Implement cleanup service for temporary files
6. Add comprehensive error handling
7. Write unit and property-based tests

## License

This project is part of the MarkItDown Website application.
