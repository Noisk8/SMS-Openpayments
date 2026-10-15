import { getAppContext } from "@/lib/context";
import { receiveSmsWebhook } from "@/lib/sms/webhook";

export const runtime = "nodejs";

/** Webhook de recepción de SMS (twilio). Solo funciona si SMS_PROVIDER=twilio. */
export async function POST(request: Request) {
  return receiveSmsWebhook("twilio", request, getAppContext());
}
