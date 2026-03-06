#!/bin/bash
# Generate self-signed TLS certificates for SwiftLogistics development
# Usage: bash scripts/generate-certs.sh

CERT_DIR="./certs"
mkdir -p "$CERT_DIR"

echo "🔐 Generating self-signed TLS certificates for SwiftLogistics..."

openssl req -x509 -nodes -days 365 \
  -newkey rsa:2048 \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.cert" \
  -subj "/C=LK/ST=Western/L=Colombo/O=SwiftLogistics/OU=Development/CN=localhost" \
  2>/dev/null

if [ $? -eq 0 ]; then
  echo "✅ Certificates generated successfully:"
  echo "   Key:  $CERT_DIR/server.key"
  echo "   Cert: $CERT_DIR/server.cert"
  echo ""
  echo "⚠️  These are self-signed certificates for DEVELOPMENT ONLY."
  echo "   Use CA-signed certificates in production."
else
  echo "❌ Failed to generate certificates. Make sure openssl is installed."
  exit 1
fi
