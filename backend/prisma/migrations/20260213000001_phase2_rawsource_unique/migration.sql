-- CreateIndex
CREATE UNIQUE INDEX "RawSourceRecord_providerId_sourceId_payloadHash_key" ON "RawSourceRecord"("providerId", "sourceId", "payloadHash");
