const core = require('@actions/core');
const exec = require('@actions/exec');
const github = require('@actions/github');
const io = require('@actions/io');
const ioUtil = require('@actions/io/lib/io-util');

const { readdirSync } = require('fs');
const path = require('path');

const getDirectories = fileName =>
  readdirSync(fileName, {
    withFileTypes: true,
  })
    .filter(dirent => dirent.isDirectory())
    .filter(dirent => !(/(^|\/)\.[^\/\.]/g).test(dirent))
    .map(dirent => dirent.name);

async function run() {
  try {
    const sourceBranch = github.context.ref
    const accessToken = core.getInput('access-token');
    const sourceChartsDir = core.getInput('source-charts-folder')  | 'charts';
    const destinationRepo = core.getInput('destination-repo');
    const destinationBranch = core.getInput('destination-branch') | 'master'
    const destinationChartsDir = core.getInput('destination-charts-folder') | 'charts';

    if (!accessToken) {
      core.setFailed(
        'No personal access token found. Please provide one by setting the `access-token` input for this action.'
      );
      return;
    }

    if (!destinationRepo) {
      core.setFailed(
        'No destination repository found. Please provide one by setting the `destination-repos` input for this action.'
      );
      return;
    }

    const sourceRepo = `${github.context.repo.owner}/${github.context.repo.repo}`;
    const sourceRepoURL = `https://${accessToken}@github.com/${sourceRepo}.git`;
    const destinationRepoURL = `https://${accessToken}@github.com/${destinationRepo}.git`;

    // clone source repo
    console.log(`Deploying to repo: ${sourceRepo} and branch: ${sourceBranch}`);
    await exec.exec(`git clone`, ['-b', sourceBranch, sourceRepoURL, 'sourceRepo'], {
      cwd: './',
    });

    // git config
    await exec.exec(`git config user.name`, [github.context.actor], {
      cwd: './',
    });
    await exec.exec(
      `git config user.email`,
      [`${github.context.actor}@users.noreply.github.com`],
      { cwd: './' }
    );

    // package helm charts
    const chartDirectories = getDirectories(path.resolve(`./sourceRepo/${sourceChartsDir}`));

    console.log('Charts dir content');
    await exec.exec(`ls`, ['-I ".*"'], { cwd: `./sourceRepo/${sourceChartsDir}` });
    for (const chartDirname of chartDirectories) {
      console.log(`Resolving helm chart dependency in directory ${chartDirname}`);
      await exec.exec(
        `helm dependency update`,
        [],
        { cwd: `./sourceRepo/${sourceChartsDir}/${chartDirname}` }
      );
      
      console.log(`Packaging helm chart in directory ${chartDirname}`);
      await exec.exec(
        `helm package`,
        [chartDirname, '--destination', '../output'],
        { cwd: `./sourceRepo/${sourceChartsDir}` }
      );
    }

    console.log('Packaged all helm charts.');

    const cnameExists = await ioUtil.exists('./CNAME');
    if (cnameExists) {
      console.log('Copying CNAME over.');
      await io.cp('./CNAME', './output/CNAME', { force: true });
      console.log('Finished copying CNAME.');
    }

    // clone destination repo
    await exec.exec(`git clone`, ['-b', destinationBranch, destinationRepoURL, 'destinationRepo'], {
      cwd: './',
    });

    // move published chart
    await exec.exec(`mv`, ['./sourceRepo/*.tgz', `./DestinationRepo/${destinationChartsDir}`], {
      cwd: './',
    });

    // push to 
    await exec.exec(`git add`, ['.'], { cwd: './DestinationRepo' });
    await exec.exec(
      `git commit`,
      ['-m', `Deployed via Helm Publish Action for ${github.context.sha}`],
      { cwd: './output' }
    );
    await exec.exec(`git push`, ['-u', 'origin', `${destinationBranch}`], {
      cwd: './output',
    });
    console.log('Finished deploying your site.');

    console.log('Enjoy! ✨');
    // generate index
    console.log(`Building index.yaml`);
    await exec.exec(`helm repo index`, `./output`);

    console.log(`Successfully build index.yaml.`);
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
