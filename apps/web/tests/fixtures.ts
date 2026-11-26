import { z } from "zod";
import type { Request } from "@playwright/test";

export function required<T>(value: T | null | undefined, message = "Fixture esperada não encontrada"): T {
  if (value == null) throw new Error(message);
  return value;
}

// Captura o JSON bruto sem descartar campos extras que as asserções verificam.
export function requestBody(request: Request): Record<string, unknown> | null {
  if (!request.postData()) return null;
  return z.record(z.string(), z.unknown()).parse(request.postDataJSON());
}

export interface CapturedRequest {
  path: string;
  method: string;
  body: Record<string, unknown> | null;
  params: URLSearchParams;
}
export interface AppointmentFixture {
  id: string;
  supplier: string;
  protocol: string;
  startTime: string;
  endTime: string;
  status: string;
  type: string | null;
  items?: number | null;
  volumes?: number | null;
  pallets?: number | null;
  hasExchanges?: boolean;
  observation?: string | null;
  origin: string;
  nfe?: string[];
  orders?: string[];
  cargaBatida?: string | null;
}
