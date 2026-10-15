import { getAppContext } from "@/lib/context";
import { receiveSmsWebhook } from "@/lib/sms/webhook";

export const runtime = "nodejs";

/** Webhook de recepción de SMS (generic). Solo funciona si SMS_PROVIDER=generic. */
export async function POST(request: Request) {
  return receiveSmsWebhook("generic", request, getAppContext());
}
