import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ServiceRuleCategory } from '../../entities/service-rule-category.entity';
import { ServiceRule } from '../../entities/service-rule.entity';
import { AiModule } from '../ai/ai.module';
import { ShopsModule } from '../shops/shops.module';
import {
  PublicServiceRulesController,
  ServiceRulesController,
} from './service-rules.controller';
import { ServiceRulesService } from './service-rules.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([ServiceRuleCategory, ServiceRule]),
    ShopsModule,
    AiModule,
  ],
  controllers: [ServiceRulesController, PublicServiceRulesController],
  providers: [ServiceRulesService],
  exports: [ServiceRulesService],
})
export class ServiceRulesModule {}
