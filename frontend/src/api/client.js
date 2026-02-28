import axios from 'axios';
import { notifications } from '@mantine/notifications';

const client = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  headers: { 'Content-Type': 'application/json' },
});

// Response interceptor for global error handling
client.interceptors.response.use(
  (response) => response,
  (error) => {
    // Extract a human-readable error message
    // FastAPI usually puts it in response.data.detail
    const message = error.response?.data?.detail
      || error.response?.data?.message
      || error.message
      || 'An unexpected error occurred';

    notifications.show({
      title: 'API Error',
      message: message,
      color: 'red',
      autoClose: 8000, // Longer duration for errors
    });

    return Promise.reject(error);
  }
);

export default client;
