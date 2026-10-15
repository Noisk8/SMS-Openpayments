import { getAppContext } from "@/lib/context";
import { receiveSmsWebhook } from "@/lib/sms/webhook";

export const runtime = "nodejs";

/** Webhook de recepción de SMS (inalambria). Solo funciona si SMS_PROVIDER=inalambria. */
export async function POST(request: Request) {
  return receiveSmsWebhook("inalambria", request, getAppContext());
}
