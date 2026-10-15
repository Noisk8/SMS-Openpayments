import { getAppContext } from "@/lib/context";
import { receiveSmsWebhook } from "@/lib/sms/webhook";

export const runtime = "nodejs";

/** Webhook de recepción de SMS (onurix). Solo funciona si SMS_PROVIDER=onurix. */
export async function POST(request: Request) {
  return receiveSmsWebhook("onurix", request, getAppContext());
}
