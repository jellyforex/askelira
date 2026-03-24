/**
 * Health check endpoint
 * Returns server status and uptime
 */
import { NextResponse } from 'next/server';
import packageJson from '@/package.json';

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'AskElira 2.1',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      version: packageJson.version,
    },
    { status: 200 }
  );
}
