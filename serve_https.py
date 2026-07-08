import argparse
import http.server
import pathlib
import ssl


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Serve this folder over HTTPS.")
  parser.add_argument("--bind", default="0.0.0.0", help="Host/interface to bind")
  parser.add_argument("--port", type=int, default=5443, help="Port to listen on")
  parser.add_argument("--cert", required=True, help="Path to PEM certificate file")
  parser.add_argument("--key", required=True, help="Path to PEM private key file")
  parser.add_argument(
    "--directory",
    default=".",
    help="Directory to serve",
  )
  return parser.parse_args()


def main() -> None:
  args = parse_args()
  directory = pathlib.Path(args.directory).resolve()
  handler = lambda *handler_args, **handler_kwargs: http.server.SimpleHTTPRequestHandler(
    *handler_args,
    directory=str(directory),
    **handler_kwargs,
  )
  server = http.server.ThreadingHTTPServer((args.bind, args.port), handler)
  context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
  context.load_cert_chain(certfile=args.cert, keyfile=args.key)
  server.socket = context.wrap_socket(server.socket, server_side=True)
  print(f"Serving HTTPS on https://{args.bind}:{args.port}/ from {directory}")
  server.serve_forever()


if __name__ == "__main__":
  main()