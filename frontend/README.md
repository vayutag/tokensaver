# MarkItDown Website - Frontend

React + TypeScript single-page application for the MarkItDown Website, built with [Vite](https://vite.dev/).

## Prerequisites

- Node.js 18+ (developed against Node 22)
- npm 10+

## Getting Started

```bash
npm install
npm run dev
```

The dev server runs at http://localhost:5173 and proxies `/api` requests to the
backend defined by `VITE_API_BASE_URL` (default `http://localhost:8000`).

## Available Scripts

| Script                 | Description                                  |
| ---------------------- | -------------------------------------------- |
| `npm run dev`          | Start the Vite development server            |
| `npm run build`        | Type-check and build for production          |
| `npm run preview`      | Preview the production build locally         |
| `npm run lint`         | Run ESLint                                   |
| `npm run lint:fix`     | Run ESLint and auto-fix issues               |
| `npm run format`       | Format source files with Prettier            |
| `npm run format:check` | Check formatting without writing changes     |
| `npm run type-check`   | Run the TypeScript compiler without emitting |

## Project Structure

```
frontend/
├── public/            # Static assets served as-is
├── src/
│   ├── components/    # React components
│   ├── services/      # API service modules (axios client)
│   ├── types/         # Shared TypeScript interfaces
│   ├── utils/         # Utility helpers and constants
│   ├── styles/        # Global and component styles
│   ├── App.tsx        # Root application component
│   └── main.tsx       # Application entry point
├── .env.example       # Environment variable template
├── .env.development   # Development environment values
└── .env.production    # Production environment values
```

## Environment Variables

Only variables prefixed with `VITE_` are exposed to the client. See
`.env.example` for the full list.

| Variable             | Description                              |
| -------------------- | ---------------------------------------- |
| `VITE_API_BASE_URL`  | Base URL of the FastAPI backend          |
| `VITE_MAX_FILE_SIZE` | Max upload size in bytes (client check)  |
| `VITE_APP_NAME`      | Application display name                 |
| `VITE_APP_ENV`       | Environment label (development/production) |
