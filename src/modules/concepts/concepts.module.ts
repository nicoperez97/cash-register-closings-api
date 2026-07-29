import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Concept } from '../../entities/concept.entity';
import { AccountsModule } from '../accounts/accounts.module';
import { ShopsModule } from '../shops/shops.module';
import { ConceptsController } from './concepts.controller';
import { ConceptsService } from './concepts.service';

@Module({
  imports: [TypeOrmModule.forFeature([Concept]), ShopsModule, AccountsModule],
  controllers: [ConceptsController],
  providers: [ConceptsService],
  exports: [ConceptsService],
})
export class ConceptsModule {}
