import { Capture, Match, Template } from '@aws-cdk/assertions';
import * as ccommit from '@aws-cdk/aws-codecommit';
import { CodeCommitTrigger, GitHubTrigger } from '@aws-cdk/aws-codepipeline-actions';
import { AnyPrincipal, Role } from '@aws-cdk/aws-iam';
import * as s3 from '@aws-cdk/aws-s3';
import { SecretValue, Stack, Token } from '@aws-cdk/core';
import * as cdkp from '../../lib';
import { PIPELINE_ENV, TestApp, ModernTestGitHubNpmPipeline } from '../testhelpers';

let app: TestApp;
let pipelineStack: Stack;

beforeEach(() => {
  app = new TestApp();
  pipelineStack = new Stack(app, 'PipelineStack', { env: PIPELINE_ENV });
});

afterEach(() => {
  app.cleanup();
});

test('CodeCommit source handles tokenized names correctly', () => {
  const repo = new ccommit.Repository(pipelineStack, 'Repo', {
    repositoryName: 'MyRepo',
  });
  new ModernTestGitHubNpmPipeline(pipelineStack, 'Pipeline', {
    input: cdkp.CodePipelineSource.codeCommit(repo, 'main'),
  });

  Template.fromStack(pipelineStack).hasResourceProperties('AWS::CodePipeline::Pipeline', {
    Stages: Match.arrayWith([{
      Name: 'Source',
      Actions: [
        Match.objectLike({
          Configuration: Match.objectLike({
            RepositoryName: { 'Fn::GetAtt': [Match.anyValue(), 'Name'] },
          }),
          Name: { 'Fn::GetAtt': [Match.anyValue(), 'Name'] },
        }),
      ],
    }]),
  });
});

test('CodeCommit source honors all valid properties', () => {
  const repo = new ccommit.Repository(pipelineStack, 'Repo', {
    repositoryName: 'MyRepo',
  });
  new ModernTestGitHubNpmPipeline(pipelineStack, 'Pipeline', {
    input: cdkp.CodePipelineSource.codeCommit(repo, 'main', {
      codeBuildCloneOutput: true,
      trigger: CodeCommitTrigger.POLL,
      eventRole: new Role(pipelineStack, 'role', {
        assumedBy: new AnyPrincipal(),
        roleName: 'some-role',
      }),
    }),
  });

  Template.fromStack(pipelineStack).hasResourceProperties('AWS::CodePipeline::Pipeline', {
    Stages: Match.arrayWith([{
      Name: 'Source',
      Actions: [
        Match.objectLike({
          Configuration: Match.objectLike({
            BranchName: 'main',
            PollForSourceChanges: true,
            OutputArtifactFormat: 'CODEBUILD_CLONE_REF',
          }),
          RoleArn: { 'Fn::GetAtt': [Match.anyValue(), 'Arn'] },
        }),
      ],
    }]),
  });
});

test('S3 source handles tokenized names correctly', () => {
  const buckit = new s3.Bucket(pipelineStack, 'Buckit');
  new ModernTestGitHubNpmPipeline(pipelineStack, 'Pipeline', {
    input: cdkp.CodePipelineSource.s3(buckit, 'thefile.zip'),
  });

  Template.fromStack(pipelineStack).hasResourceProperties('AWS::CodePipeline::Pipeline', {
    Stages: Match.arrayWith([{
      Name: 'Source',
      Actions: [
        Match.objectLike({
          Configuration: Match.objectLike({
            S3Bucket: { Ref: Match.anyValue() },
            S3ObjectKey: 'thefile.zip',
          }),
          Name: { Ref: Match.anyValue() },
        }),
      ],
    }]),
  });
});

test('GitHub source honors all valid properties', () => {
  new ModernTestGitHubNpmPipeline(pipelineStack, 'Pipeline', {
    input: cdkp.CodePipelineSource.gitHub('owner/repo', 'main', {
      trigger: GitHubTrigger.POLL,
      authentication: SecretValue.plainText('super-secret'),
    }),
  });

  Template.fromStack(pipelineStack).hasResourceProperties('AWS::CodePipeline::Pipeline', {
    Stages: Match.arrayWith([{
      Name: 'Source',
      Actions: [
        Match.objectLike({
          Configuration: Match.objectLike({
            Owner: 'owner',
            Repo: 'repo',
            Branch: 'main',
            PollForSourceChanges: true,
            OAuthToken: 'super-secret',
          }),
          Name: 'owner_repo',
        }),
      ],
    }]),
  });
});

test('GitHub source does not accept ill-formatted identifiers', () => {
  expect(() => {
    new ModernTestGitHubNpmPipeline(pipelineStack, 'Pipeline', {
      input: cdkp.CodePipelineSource.gitHub('repo-only', 'main'),
    });
  }).toThrow('GitHub repository name should be a resolved string like \'<owner>/<repo>\', got \'repo-only\'');
});

test('GitHub source does not accept unresolved identifiers', () => {
  expect(() => {
    new ModernTestGitHubNpmPipeline(pipelineStack, 'Pipeline', {
      input: cdkp.CodePipelineSource.gitHub(Token.asString({}), 'main'),
    });
  }).toThrow(/Step id cannot be unresolved/);
});

test('Dashes in repo names are removed from artifact names', () => {
  new ModernTestGitHubNpmPipeline(pipelineStack, 'Pipeline', {
    input: cdkp.CodePipelineSource.gitHub('owner/my-repo', 'main'),
  });

  Template.fromStack(pipelineStack).hasResourceProperties('AWS::CodePipeline::Pipeline', {
    Stages: Match.arrayWith([{
      Name: 'Source',
      Actions: [
        Match.objectLike({
          OutputArtifacts: [
            { Name: 'owner_my_repo_Source' },
          ],
        }),
      ],
    }]),
  });
});

test('artifact names are never longer than 128 characters', () => {
  new ModernTestGitHubNpmPipeline(pipelineStack, 'Pipeline', {
    input: cdkp.CodePipelineSource.gitHub('owner/' + 'my-repo'.repeat(100), 'main'),
  });

  const artifactId = new Capture();
  Template.fromStack(pipelineStack).hasResourceProperties('AWS::CodePipeline::Pipeline', {
    Stages: Match.arrayWith([{
      Name: 'Source',
      Actions: [
        Match.objectLike({
          OutputArtifacts: [
            { Name: artifactId },
          ],
        }),
      ],
    }]),
  });

  expect(artifactId.asString().length).toBeLessThanOrEqual(128);
});

test('can use source attributes in pipeline', () => {
  const gitHub = cdkp.CodePipelineSource.gitHub('owner/my-repo', 'main');

  // WHEN
  new ModernTestGitHubNpmPipeline(pipelineStack, 'Pipeline', {
    input: gitHub,
    synth: new cdkp.ShellStep('Synth', {
      env: {
        GITHUB_URL: gitHub.sourceAttribute('CommitUrl'),
      },
      commands: [
        'echo "Click here: $GITHUB_URL"',
      ],
    }),
    selfMutation: false,
  });

  Template.fromStack(pipelineStack).hasResourceProperties('AWS::CodePipeline::Pipeline', {
    Stages: [
      { Name: 'Source' },
      {
        Name: 'Build',
        Actions: [
          {
            Name: 'Synth',
            Configuration: Match.objectLike({
              EnvironmentVariables: Match.serializedJson([
                {
                  name: 'GITHUB_URL',
                  type: 'PLAINTEXT',
                  value: '#{Source@owner_my-repo.CommitUrl}',
                },
              ]),
            }),
          },
        ],
      },
    ],
  });
});