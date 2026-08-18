#!/bin/bash
# Serve the study guide locally (phones on the same wifi join via LAN IP).
# This server also shares votes across devices at the venue.
cd "$(dirname "$0")"
python3 server.py 8080
