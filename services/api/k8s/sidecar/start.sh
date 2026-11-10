#!/bin/sh
# nginx cannot read a file into a variable, so render the mounted token into a config
# line, then become nginx. Runs once per container start, which is why rotating the
# token needs a restart (ADR 0015). The token is hex: nothing here needs escaping.
set -eu
umask 077
# $expected_authorization is nginx's variable, not the shell's: it must stay literal.
# shellcheck disable=SC2016
printf 'set $expected_authorization "Bearer %s";\n' "$(cat /run/secrets/api-token/token)" \
  > /tmp/expected-authorization.conf
exec nginx -g 'daemon off;'
