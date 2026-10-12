pipeline {
    agent none

    options {
        timeout(time: 45, unit: 'MINUTES')
        disableConcurrentBuilds()
        skipDefaultCheckout(true)
        buildDiscarder(logRotator(numToKeepStr: '20'))
    }

    stages {
        stage('Linux Node 22 and 24') {
            agent { label 'macmini' }
            environment {
                PATH = "/opt/homebrew/bin:${env.PATH}"
                DOCKER_HOST = 'unix:///Users/kimjinseong/.colima/ci/docker.sock'
            }
            steps {
                checkout scm
                sh 'colima start --profile ci --activate=false'
                sh 'docker build --build-arg NODE_VERSION=22.23.2 -t inho-team-qe-framework-ci:node22 -f .ci/Dockerfile.linux .'
                sh 'docker build --build-arg NODE_VERSION=24.15.0 -t inho-team-qe-framework-ci:node24 -f .ci/Dockerfile.linux .'
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                    sh '''docker run --rm -e HOME=/tmp -v "$WORKSPACE:/workspace" -w /workspace inho-team-qe-framework-ci:node22 sh .ci/run-linux.sh guards'''
                }
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                    sh '''docker run --rm -e HOME=/tmp -v "$WORKSPACE:/workspace" -w /workspace inho-team-qe-framework-ci:node24 sh .ci/run-linux.sh guards'''
                }
                catchError(buildResult: 'FAILURE', stageResult: 'FAILURE') {
                    sh '''docker run --rm -e HOME=/tmp -v "$WORKSPACE:/workspace" -w /workspace inho-team-qe-framework-ci:node22 sh .ci/run-linux.sh native'''
                }
            }
            post {
                always {
                    sh '''
                        if docker info >/dev/null 2>&1; then
                            running=$(docker ps -q)
                            if [ -z "$running" ]; then
                                colima stop --profile ci
                            else
                                echo "CI Docker has running containers; inspect them before stopping the profile."
                            fi
                        fi
                    '''
                    cleanWs(deleteDirs: true, notFailBuild: true)
                }
            }
        }

        stage('macOS Node 22 native package') {
            agent { label 'macmini' }
            environment {
                PATH = "/Users/kimjinseong/.nvm/versions/node/v22.23.2/bin:${env.PATH}"
            }
            steps {
                checkout scm
                sh 'node --version && npm ci --ignore-scripts --omit=optional'
                sh 'node --test scripts/lib/__tests__/npm-lifecycle.test.mjs scripts/lib/__tests__/package-lifecycle.test.mjs scripts/lib/__tests__/package-provenance.test.mjs'
            }
            post { always { cleanWs(deleteDirs: true, notFailBuild: true) } }
        }
    }
}
