'use strict';

import * as chai from 'chai';
const chaiAsPromised = require('chai-as-promised');
const sinonChai = require('sinon-chai');
import { expect } from 'chai';
import * as sinon from 'sinon';
import { PrecompileEmailService } from './precompile_email_service';
import { Email } from './email';
import * as emailParams from './send_email_topic_canonical_message.json';
const awsMock = require('aws-sdk-mock');
const AWS = require('aws-sdk-promise');

chai.use(chaiAsPromised);
chai.use(sinonChai);

describe('PrecompileEmailService', () => {
  const userApiKey = emailParams.sender.apiKey;
  const fakeQueueUrl = 'https://somefakeurl.com/';
  const linksServiceHost = 'fakeapi.com';
  const linksServiceUrl = `https://${linksServiceHost}/links`;
  let sqsClient;
  let precompileService;

  before(() => {
    sqsClient = new AWS.SQS();
    precompileService = new PrecompileEmailService(sqsClient, emailParams, linksServiceHost);
  });

  describe('#constructor()', () => {
    it('initializes an EmailQueue object with the user\'s api key as name', (done) => {
      expect(precompileService.queue.name).to.equal(userApiKey);
      done();
    });

    it('initializes an Email object', (done) => {
      expect(precompileService.email).to.be.an.instanceOf(Email);
      expect(precompileService.email.from).to.equal(emailParams.sender.emailAddress);
      expect(precompileService.email.to).to.equal(emailParams.recipient.email);
      expect(precompileService.email.body).to.equal(emailParams.campaign.body);
      expect(precompileService.email.subject).to.equal(emailParams.campaign.subject);
      expect(precompileService.email.metadata).to.deep.equal(emailParams.recipient.metadata);
      done();
    });
  });

  describe('#composeEmail()', () => {
    it('returns an object with the SendEmail queue canonical format', (done) => {
      precompileService.composeEmail().then((composedEmail) => {
        expect(composedEmail.userId).to.equal(emailParams.userId);
        expect(composedEmail.sender).to.deep.equal(emailParams.sender);
        expect(composedEmail.recipient).to.deep.equal(emailParams.recipient);
        expect(composedEmail.campaign.id).to.equal(emailParams.campaign.id);
        expect(composedEmail.campaign.body).to.contain(emailParams.recipient.metadata.name);
        expect(composedEmail.campaign.subject).to.contain(emailParams.recipient.metadata.name);
        done();
      });
    });
  });

  describe('#enqueueEmail()', () => {
    context('when the user\'s queue does not exist', () => {
      before(() => {
        awsMock.mock('CloudWatch', 'putMetricAlarm', true);
        awsMock.mock('SQS', 'getQueueUrl', (params, cb) => {
          const error = {code: 'AWS.SimpleQueueService.NonExistentQueue'};
          cb(error);
        });
        awsMock.mock('SQS', 'createQueue', (params, cb) => {
          const value = {QueueUrl: `${fakeQueueUrl}${params.QueueName}`};
          cb(null, value);
        });
        awsMock.mock('SQS', 'sendMessage', {ReceiptHandle: 'some_handle'});
        sqsClient = new AWS.SQS();
        precompileService = new PrecompileEmailService(sqsClient, emailParams, linksServiceHost);
      });

      it('creates a queue named after the user\'s api key', (done) => {
        precompileService.enqueueEmail().then(() => {
          expect(sqsClient.createQueue).to.have.been.calledWith({QueueName: userApiKey});
          done();
        });
      });

      it('enqueues the composed email in the newly created queue', (done) => {
        expect(precompileService.enqueueEmail()).to.eventually.have.property('QueueName');
        done();
      });

      after(() => {
        awsMock.restore('SQS');
        awsMock.restore('CloudWatch');
      });
    });

    context('when the user\'s queue exists', () => {
      before(() => {
        awsMock.mock('SQS', 'getQueueUrl', (params, cb) => {
          const value = {QueueUrl: `${fakeQueueUrl}${params.QueueName}`};
          cb(null, value);
        });
        awsMock.mock('SQS', 'sendMessage', {ReceiptHandle: 'some_handle'});
        sqsClient = new AWS.SQS();
        sinon.spy(sqsClient, 'createQueue');
        precompileService = new PrecompileEmailService(sqsClient, emailParams, linksServiceHost);
      });

      it('enqueues the composed email in the queue named after the user\'s api key', (done) => {
        precompileService.enqueueEmail().then((value) => {
          expect(sqsClient.getQueueUrl).to.have.been.calledWith({QueueName: userApiKey});
          expect(sqsClient.createQueue).to.have.callCount(0);
          expect(value).to.have.property('ReceiptHandle');
          done();
        });
      });

      after(() => {
        awsMock.restore('SQS');
        sqsClient.createQueue.restore();
      });
    });
  });

});
