import axios from 'axios';

// Use a relative baseURL so API calls route through whatever origin serves
// the app — works locally (localhost:5173), behind nginx (/api/...), or in
// Docker without any env var changes.
//
// Override with VITE_API_URL in .env for split-origin deployments only
// (e.g. VITE_API_URL=https://api.example.com when the API is on a separate host).
const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: { 'Content-Type': 'application/json' },
});

export default client;
