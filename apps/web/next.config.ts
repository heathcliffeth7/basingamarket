import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  allowedDevOrigins: ['127.0.0.1', 'localhost', 'basingamarket.com', 'www.basingamarket.com'],
  images: {
    unoptimized: true
  }
};

export default nextConfig;
