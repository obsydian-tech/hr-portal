import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { attributes, blocks, type Block } from '../infra-harness';
import { STACKS, filesOf, lambdaNamed, policyLines, resourcesOf, roleResourceOf, settingsOf, squash, valueOf, type Stack } from '../mod-01/iam';
import { REPO } from './lambda-harness';

/**
 * CHAT-02: both Terraform stacks read as text (there is no Terraform here; the PR's required Terraform check runs the real
 * plan on pepla-dev). Helpers over ../mod-01/iam.ts, which resolves locals and finds Lambdas and roles.
 */
export { STACKS, lambdaNamed, policyLines, resourcesOf, roleResourceOf, settingsOf, squash, valueOf };
export type { Stack, Block };

export const TABLE_NAME = 'ask-batsi-chats';

/** Every aws_dynamodb_table in both stacks. */
export const allTables = () => STACKS.flatMap((stack) => resourcesOf(stack, 'aws_dynamodb_table').map((block) => ({ stack, block })));

export function chatsTable() {
  return allTables().filter((t) => valueOf(t.stack, attributes(t.block.body).get('name')) === TABLE_NAME);
}

/** The aws_apigatewayv2_route blocks whose route_key is `key`. */
export function routesOf(key: string) {
  return STACKS.flatMap((stack) => resourcesOf(stack, 'aws_apigatewayv2_route')
    .filter((b) => valueOf(stack, attributes(b.body).get('route_key')) === key.replace(/\s+/g, ''))
    .map((block) => ({ stack, block })));
}

/** The Lambda function name a route's integration invokes (undefined when it cannot be followed). */
export function lambdaOfRoute(stack: Stack, route: Block): string | undefined {
  const integ = /^"integrations\/\$\{aws_apigatewayv2_integration\.([\w-]+)\.id\}"$/.exec(attributes(route.body).get('target') ?? '')?.[1];
  const integration = resourcesOf(stack, 'aws_apigatewayv2_integration').find((b) => b.labels[1] === integ);
  const fnLabel = /^aws_lambda_function\.([\w-]+)\.invoke_arn$/.exec(attributes(integration?.body ?? '').get('integration_uri') ?? '')?.[1];
  const fn = resourcesOf(stack, 'aws_lambda_function').find((b) => b.labels[1] === fnLabel);
  return fn ? valueOf(stack, attributes(fn.body).get('function_name')) : undefined;
}

/** The API a route sits on: its resource label and the squashed cors_configuration text. */
export function apiOfRoute(stack: Stack, route: Block): { label: string; cors: string } | undefined {
  const label = /^aws_apigatewayv2_api\.([\w-]+)\.id$/.exec(attributes(route.body).get('api_id') ?? '')?.[1];
  const api = resourcesOf(stack, 'aws_apigatewayv2_api').find((b) => b.labels[1] === label);
  return api && label ? { label, cors: squash(api.body) } : undefined;
}

/** Every allow_headers list of every API in both stacks, as text, keyed by the API's resource label. */
export function allowHeaders(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const stack of STACKS) {
    for (const b of resourcesOf(stack, 'aws_apigatewayv2_api')) {
      out[`${stack}/${b.labels[1]}`] = /allow_headers=(\[[^\]]*\])/.exec(squash(b.body))?.[1] ?? '';
    }
  }
  return out;
}

/** The text of every .tf file of both stacks, comments left in. */
export const tfText = () => STACKS.flatMap((s) => filesOf(s).map((f) => readFileSync(f, 'utf8'))).join('\n');

export const sha = (path: string) => readFileSync(join(REPO, path), 'utf8');
export const lambdaDirs = () => readdirSync(join(REPO, 'lambda'), { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name);
