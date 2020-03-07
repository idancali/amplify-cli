import { GraphQLTransform } from 'graphql-transformer-core';
import { DynamoDBModelTransformer } from 'graphql-dynamodb-transformer';
import { FunctionTransformer } from 'graphql-function-transformer';
import { ModelAuthTransformer } from '../ModelAuthTransformer';
import { ObjectTypeDefinitionNode, DocumentNode, Kind, parse } from 'graphql';

describe('@auth directive without @model', async () => {
  const getObjectType = (doc: DocumentNode, type: string): ObjectTypeDefinitionNode | undefined => {
    return doc.definitions.find(def => def.kind === Kind.OBJECT_TYPE_DEFINITION && def.name.value === type) as
      | ObjectTypeDefinitionNode
      | undefined;
  };

  const getField = (type, name) => type.fields.find(f => f.name.value === name);

  const expectNone = fieldOrType => {
    expect(fieldOrType.directives.length === 0);
  };

  const expectOne = (fieldOrType, directiveName) => {
    expect(fieldOrType.directives.length === 1);
    expect(fieldOrType.directives.find(d => d.name.value === directiveName)).toBeDefined();
  };

  test('Test that @auth with no @model on type is failing validation as model is required', () => {
    const validSchema = `
      type Post
      @auth (
        rules: [
          { allow: owner, operations: [read] },
        ]) {
          id: ID!
          text: String!
          owner: String
      }
      `;

    const transformer = new GraphQLTransform({
      transformers: [
        new DynamoDBModelTransformer(),
        new ModelAuthTransformer({
          authConfig: {
            defaultAuthentication: {
              authenticationType: 'AMAZON_COGNITO_USER_POOLS',
            },
            additionalAuthenticationProviders: [],
          },
        }),
      ],
    });

    const t = () => {
      const out = transformer.transform(validSchema);
    };

    expect(t).toThrowError(`Types annotated with @auth must also be annotated with @model.`);
  });

  test('Test that @auth with no @model on field is failing validation when operations specified', () => {
    const validSchema = `
      type Post {
          id: ID!
          text: String!
          @auth (
            rules: [
              { allow: owner, operations: [read] },
            ])
          owner: String
      }
      `;

    const transformer = new GraphQLTransform({
      transformers: [
        new DynamoDBModelTransformer(),
        new ModelAuthTransformer({
          authConfig: {
            defaultAuthentication: {
              authenticationType: 'AMAZON_COGNITO_USER_POOLS',
            },
            additionalAuthenticationProviders: [],
          },
        }),
      ],
    });

    const t = () => {
      const out = transformer.transform(validSchema);
    };

    expect(t)
      .toThrowError(`@auth rules on fields within types that does not have @model directive cannot specify 'operations' argument as there are \
operations will be generated by the CLI.`);
  });

  test('Test that @auth on Query field is failing validation when operations specified', () => {
    const validSchema = `
      type Query {
          getSecret: String!
          @auth (
            rules: [
              { allow: owner, operations: [read] },
            ])
      }
      `;

    const transformer = new GraphQLTransform({
      transformers: [
        new DynamoDBModelTransformer(),
        new ModelAuthTransformer({
          authConfig: {
            defaultAuthentication: {
              authenticationType: 'AMAZON_COGNITO_USER_POOLS',
            },
            additionalAuthenticationProviders: [],
          },
        }),
      ],
    });

    const t = () => {
      const out = transformer.transform(validSchema);
    };

    expect(t).toThrowError(`@auth rules on fields within Query, Mutation, Subscription cannot specify 'operations' argument as these rules \
are already on an operation already.`);
  });

  test('Test that @auth on Query field is not getting auth directive added', () => {
    const validSchema = `
      type Query {
          getSecret: String!
          @auth (
            rules: [
              { allow: private, provider: iam },
            ])
      }
      `;

    const transformer = new GraphQLTransform({
      transformers: [
        new DynamoDBModelTransformer(),
        new ModelAuthTransformer({
          authConfig: {
            defaultAuthentication: {
              authenticationType: 'AMAZON_COGNITO_USER_POOLS',
            },
            additionalAuthenticationProviders: [
              {
                authenticationType: 'AWS_IAM',
              },
            ],
          },
        }),
      ],
    });

    const out = transformer.transform(validSchema);
    const schemaDoc = parse(out.schema);

    const queryType = getObjectType(schemaDoc, 'Query');

    expectNone(queryType);
  });

  test('Test that @auth on getSecret will not get directive with default auth', () => {
    const validSchema = `
      type Query {
          getSecret: String!
          @auth (
            rules: [
              { allow: private },
            ])
      }
      `;

    const transformer = new GraphQLTransform({
      transformers: [
        new DynamoDBModelTransformer(),
        new ModelAuthTransformer({
          authConfig: {
            defaultAuthentication: {
              authenticationType: 'AMAZON_COGNITO_USER_POOLS',
            },
            additionalAuthenticationProviders: [
              {
                authenticationType: 'AWS_IAM',
              },
            ],
          },
        }),
      ],
    });

    const out = transformer.transform(validSchema);
    const schemaDoc = parse(out.schema);

    const queryType = getObjectType(schemaDoc, 'Query');

    expectNone(queryType);
    expectNone(getField(queryType, 'getSecret'));
  });

  test('Test that @auth on getSecret gets the right directive', () => {
    const validSchema = `
      type Query {
          getSecret: String!
          @auth (
            rules: [
              { allow: private, provider: iam },
            ])
      }
      `;

    const transformer = new GraphQLTransform({
      transformers: [
        new DynamoDBModelTransformer(),
        new ModelAuthTransformer({
          authConfig: {
            defaultAuthentication: {
              authenticationType: 'AMAZON_COGNITO_USER_POOLS',
            },
            additionalAuthenticationProviders: [
              {
                authenticationType: 'AWS_IAM',
              },
            ],
          },
        }),
      ],
    });

    const out = transformer.transform(validSchema);
    const schemaDoc = parse(out.schema);

    const queryType = getObjectType(schemaDoc, 'Query');

    expectNone(queryType);
    expectOne(getField(queryType, 'getSecret'), 'aws_iam');
  });

  test('Test that IAM on getSecret gets the right IAM policy for AuthRole', () => {
    const validSchema = `
      type Query {
          getSecret: String!
          @auth (
            rules: [
              { allow: private, provider: iam },
            ])
          @function (name: "getSecret-\${env}")
      }
      `;

    const transformer = new GraphQLTransform({
      transformers: [
        new DynamoDBModelTransformer(),
        new FunctionTransformer(),
        new ModelAuthTransformer({
          authConfig: {
            defaultAuthentication: {
              authenticationType: 'AMAZON_COGNITO_USER_POOLS',
            },
            additionalAuthenticationProviders: [
              {
                authenticationType: 'AWS_IAM',
              },
            ],
          },
        }),
      ],
    });

    const out = transformer.transform(validSchema);

    expect(out.rootStack.Resources.AuthRolePolicy01).toBeTruthy();
    expect(out.rootStack.Resources.AuthRolePolicy01.Properties.PolicyDocument.Statement[0].Resource.length).toEqual(1);
    expect(out.rootStack.Resources.UnauthRolePolicy01).toBeUndefined();
  });

  test('Test that IAM on getSecret gets the right IAM policy for AuthRole and UnauthRole', () => {
    const validSchema = `
      type Query {
          getSecret: String!
          @auth (
            rules: [
              { allow: public, provider: iam },
            ])
          @function (name: "getSecret-\${env}")
      }
      `;

    const transformer = new GraphQLTransform({
      transformers: [
        new DynamoDBModelTransformer(),
        new FunctionTransformer(),
        new ModelAuthTransformer({
          authConfig: {
            defaultAuthentication: {
              authenticationType: 'AMAZON_COGNITO_USER_POOLS',
            },
            additionalAuthenticationProviders: [
              {
                authenticationType: 'AWS_IAM',
              },
            ],
          },
        }),
      ],
    });

    const out = transformer.transform(validSchema);

    expect(out.rootStack.Resources.AuthRolePolicy01).toBeTruthy();
    expect(out.rootStack.Resources.AuthRolePolicy01.Properties.PolicyDocument.Statement[0].Resource.length).toEqual(1);
    expect(out.rootStack.Resources.UnauthRolePolicy01).toBeTruthy();
    expect(out.rootStack.Resources.UnauthRolePolicy01.Properties.PolicyDocument.Statement[0].Resource.length).toEqual(1);
  });
});