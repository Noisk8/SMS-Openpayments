// Valores exclusivos para pruebas. No son secretos reales.
process.env.PAYMENT_PROVIDER = "mock";
process.env.SMS_PROVIDER = "mock";
process.env.MOCK_CURRENCY = "COP";
process.env.MOCK_ASSET_SCALE = "0";
process.env.SMS_SIMULATOR_ENABLED = "true";
process.env.APP_URL = "http://localhost:3000";
process.env.ENCRYPTION_KEY ??= Buffer.alloc(32, 7).toString("base64");
process.env.TWILIO_ACCOUNT_SID = "ACtest00000000000000000000000000";
process.env.TWILIO_AUTH_TOKEN = "test_auth_token";
process.env.TWILIO_PHONE_NUMBER = "+15005550006";
process.env.GENERIC_SMS_API_URL = "https://api.proveedor.example/sms";
process.env.GENERIC_SMS_API_KEY = "test_generic_key";
process.env.GENERIC_SMS_WEBHOOK_SECRET = "test_generic_webhook_secret";
process.env.ONURIX_API_KEY = "test_onurix_key";
process.env.ONURIX_CLIENT_ID = "1";
process.env.INALAMBRIA_USER = "test_user";
process.env.INALAMBRIA_PASSWORD = "test_password";
