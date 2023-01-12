/* eslint-disable no-console */
const execa = require('execa')
const { Octokit } = require('@octokit/core')

const { getNextVersionForBinary } = require('../get-next-version')
const { validateChangelogEntry } = require('./validate-changelog-entry')
const { getLinkedIssues } = require('./get-linked-issues')

const octokit = new Octokit()

const getChangedFilesSinceLastRelease = async (latestReleaseInfo) => {
  const { stdout } = await execa('git', ['diff', `${latestReleaseInfo.buildSha}..`, '--name-only'])

  if (!stdout) {
    console.log('no files changes since last release')

    return []
  }

  return stdout.split('\n')
}

const validateChangelog = async () => {
  try {
    console.log('Get Current Release Information\n')
    const { stdout } = await execa('npm', ['info', 'cypress', '--json'])
    const npmInfo = JSON.parse(stdout)

    const latestReleaseInfo = {
      version: npmInfo['dist-tags'].latest,
      commitDate: npmInfo.buildInfo.commitDate,
      buildSha: npmInfo.buildInfo.commitSha,
    }

    console.log(latestReleaseInfo)

    const {
      nextVersion,
      commits,
    } = await getNextVersionForBinary()

    console.log({ nextVersion })
    console.log('User-facing commits since last release', commits)

    const changedFiles = await getChangedFilesSinceLastRelease(latestReleaseInfo)

    console.log('changes files', typeof changedFiles)

    const issuesInRelease = []
    const prsInRelease = []

    await Promise.all(commits.map(async (semanticResult) => {
      if (!semanticResult) return

      const { type: semanticType, references } = semanticResult

      console.log(references)
      if (!references.length || !references[0].issue) {
        console.log('Commit does not have an associated pull request number')

        return
      }

      const { data: pullRequest } = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
        owner: 'cypress-io',
        repo: 'cypress',
        pull_number: references[0].issue,
      })

      const associatedIssues = getLinkedIssues(pullRequest.body)

      await validateChangelogEntry({
        nextVersion,
        prNumber: references.issue,
        changedFiles,
        semanticType,
        associatedIssues,
      })

      prsInRelease.push(`https://github.com/cypress-io/cypress/pulls/${references.issue}`)

      associatedIssues.forEach((issueNumber) => {
        issuesInRelease.push(`https://github.com/cypress-io/cypress/issues/${issueNumber}`)
      })
    }))

    console.log(`${prsInRelease.length} user-facing pull requests have merged since ${latestReleaseInfo.version} was released.`)
    console.log(`${issuesInRelease.length} user-facing issues closed since ${latestReleaseInfo.version} was released.`)

    return {
      issuesInRelease,
      prsInRelease,
    }
  } catch (e) {
    throw e
  }
}

if (require.main !== module) {
  module.exports.validateChangelog = validateChangelog

  return
}

(async () => {
  await validateChangelog()
})()
