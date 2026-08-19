import { Global, Module } from '@nestjs/common';
import { ShopLiveService } from './shop-live.service';

@Global()
@Module({
  providers: [ShopLiveService],
  exports: [ShopLiveService],
})
export class ShopLiveModule {}
